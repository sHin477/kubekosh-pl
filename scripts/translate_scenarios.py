#!/usr/bin/env python3
"""
translate_scenarios.py
======================
Tłumaczy pliki JSON scenariuszy KubeKosh na dowolny język za pomocą Anthropic API.

Wymagania:
    pip install anthropic

Użycie:
    # Ustaw klucz API
    export ANTHROPIC_API_KEY="sk-ant-..."

    # Tłumaczenie na polski (domyślnie)
    python translate_scenarios.py

    # Tłumaczenie na inny język
    python translate_scenarios.py --lang german
    python translate_scenarios.py --lang spanish
    python translate_scenarios.py --lang french

    # Opcje zaawansowane
    python translate_scenarios.py --scenarios-dir ./scenarios/data --output-dir ./scenarios/pl --lang polish
    python translate_scenarios.py --dry-run          # Podgląd bez zapisu
    python translate_scenarios.py --resume           # Wznów przerwaną sesję
    python translate_scenarios.py --file broken-deployment.json  # Jeden plik
    python translate_scenarios.py --workers 3        # Równoległe tłumaczenie (ostrożnie z rate limits)
"""

import anthropic
import json
import os
import sys
import time
import argparse
import hashlib
import re
import shutil
import concurrent.futures
from pathlib import Path
from datetime import datetime
from typing import Optional

# ─── Konfiguracja ─────────────────────────────────────────────────────────────

DEFAULT_SCENARIOS_DIR = "./scenarios/data"
DEFAULT_OUTPUT_DIR    = None          # None = nadpisuj in-place
DEFAULT_LANGUAGE      = "polish"
DEFAULT_MODEL         = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS    = 4096
DEFAULT_WORKERS       = 1             # Domyślnie sekwencyjnie — bezpieczniej
PROGRESS_FILE         = ".translate_progress.json"
BACKUP_SUFFIX         = ".bak"

# Opóźnienie między requestami (sekundy) — chroni przed rate limit
REQUEST_DELAY_SECS = 1.0

# ─── Prompt systemowy ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a professional technical translator specializing in IT, DevOps, and Kubernetes.
You translate JSON scenario files for a Kubernetes training lab into the target language.

ABSOLUTE RULES — never break these:
1. Return ONLY valid JSON — no explanation, no markdown fences, no text before or after
2. DO NOT translate: field names/keys (title, description, hints, body, command, etc.)
3. DO NOT translate: shell commands, kubectl commands, bash code — leave them byte-for-byte identical
4. DO NOT translate: content inside markdown code fences (``` blocks)
5. DO NOT translate: Kubernetes resource names used as identifiers (pod names, deployment names, namespace names appearing as values in commands)
6. DO NOT translate: values of: "id", "type", "difficulty", "category", "correct_option", "match", "expected_output"
7. DO NOT translate: inline code in backticks that is a command or resource name (e.g. `kubectl get pods`, `nginx:1.25`)
8. PRESERVE exactly: all markdown formatting (##, **, *, >, `, ```, newlines, bullet points)
9. PRESERVE exactly: all escape sequences (\\n, \\t, \\\\, etc.) in JSON strings
10. PRESERVE exactly: numeric values, booleans, null, arrays structure, object structure

TRANSLATE these string values:
- "title"                          → translate the scenario title
- "description"                    → translate narrative text, headings, instructions ONLY
                                     (skip code blocks, skip inline kubectl commands)
- "hints[].title"                  → translate hint titles
- "hints[].body"                   → translate hint body text (NOT "hints[].command")
- "options[].text"                 → translate MCQ answer text
- "explanation"                    → translate MCQ explanation text
- "validation.description"         → translate validation section description
- "validation.commands[].description" → translate check description labels

INLINE CODE RULE:
- `kubectl get pods` → DO NOT translate (it's a command)
- `broken-app` → DO NOT translate (it's a resource name)
- `debug` namespace → DO NOT translate the word after "namespace" if it's a name
- But: translate surrounding prose, e.g. "Run `kubectl get pods` to see the pods" →
  translate "Run ... to see the pods", keep `kubectl get pods` verbatim

The target language is specified in the user message."""

# ─── Pomocnicze ───────────────────────────────────────────────────────────────

def file_hash(path: Path) -> str:
    """SHA-256 skrótu pliku — do wykrywania zmian."""
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def load_progress(progress_path: Path) -> dict:
    if progress_path.exists():
        try:
            return json.loads(progress_path.read_text())
        except Exception:
            pass
    return {"completed": {}, "failed": {}, "started_at": datetime.now().isoformat()}


def save_progress(progress_path: Path, progress: dict):
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2))


def backup_file(path: Path):
    """Tworzy kopię zapasową .bak jeśli jeszcze nie istnieje."""
    bak = path.with_suffix(path.suffix + BACKUP_SUFFIX)
    if not bak.exists():
        shutil.copy2(path, bak)


def strip_code_fences(text: str) -> str:
    """Usuwa ``` json ... ``` jeśli model zwrócił JSON w bloku kodu."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        # Usuń pierwszą linię (```json lub ```) i ostatnią (```)
        end = len(lines) - 1
        while end > 0 and lines[end].strip() == "```":
            end -= 1
        text = "\n".join(lines[1:end+1]).strip()
    return text


def validate_translation(original: dict, translated: dict) -> list[str]:
    """
    Sprawdza czy tłumaczenie nie naruszyło struktury.
    Zwraca listę błędów (pusta = OK).
    """
    errors = []

    # Sprawdź niezmieniane pola
    immutable_fields = ["id", "type", "difficulty", "category", "correct_option",
                        "weight", "default_namespace"]
    for field in immutable_fields:
        if field in original and original[field] != translated.get(field):
            errors.append(
                f"Pole '{field}' zostało zmienione: "
                f"'{original[field]}' → '{translated.get(field)}'"
            )

    # Sprawdź komendy w hints
    orig_hints = original.get("hints", [])
    trans_hints = translated.get("hints", [])
    if len(orig_hints) != len(trans_hints):
        errors.append(
            f"Liczba hints zmieniła się: {len(orig_hints)} → {len(trans_hints)}"
        )
    else:
        for i, (oh, th) in enumerate(zip(orig_hints, trans_hints)):
            if oh.get("command") != th.get("command"):
                errors.append(
                    f"hints[{i}].command został zmieniony:\n"
                    f"  Przed: {oh.get('command')!r}\n"
                    f"  Po:    {th.get('command')!r}"
                )

    # Sprawdź komendy walidacji
    orig_vcmds = original.get("validation", {}).get("commands", [])
    trans_vcmds = translated.get("validation", {}).get("commands", [])
    if len(orig_vcmds) != len(trans_vcmds):
        errors.append(
            f"Liczba validation.commands zmieniła się: "
            f"{len(orig_vcmds)} → {len(trans_vcmds)}"
        )
    else:
        for i, (oc, tc) in enumerate(zip(orig_vcmds, trans_vcmds)):
            for key in ["command", "expected_output", "match"]:
                if oc.get(key) != tc.get(key):
                    errors.append(
                        f"validation.commands[{i}].{key} zmieniony:\n"
                        f"  Przed: {oc.get(key)!r}\n"
                        f"  Po:    {tc.get(key)!r}"
                    )

    # Sprawdź setup/teardown commands
    for section in ["setup_commands", "teardown_commands"]:
        orig_cmds = [c["command"] for c in original.get(section, [])]
        trans_cmds = [c["command"] for c in translated.get(section, [])]
        if orig_cmds != trans_cmds:
            errors.append(f"Komendy w sekcji '{section}' zostały zmienione!")

    # Sprawdź options (MCQ) — tylko ID i ich kolejność
    orig_opts = [o["id"] for o in original.get("options", [])]
    trans_opts = [o["id"] for o in translated.get("options", [])]
    if orig_opts != trans_opts:
        errors.append(
            f"IDs opcji MCQ zmienione: {orig_opts} → {trans_opts}"
        )

    return errors


# ─── Tłumaczenie jednego pliku ─────────────────────────────────────────────────

def translate_file(
    client: anthropic.Anthropic,
    input_path: Path,
    output_path: Path,
    language: str,
    dry_run: bool = False,
    retries: int = 3,
) -> tuple[bool, str]:
    """
    Tłumaczy jeden plik JSON.
    Zwraca (sukces: bool, komunikat: str).
    """
    # Wczytaj oryginał
    try:
        original_text = input_path.read_text(encoding="utf-8")
        original_data = json.loads(original_text)
    except Exception as e:
        return False, f"Błąd odczytu pliku: {e}"

    scenario_id = original_data.get("id", input_path.stem)
    scenario_title = original_data.get("title", "?")

    user_message = f"""Translate the following Kubernetes scenario JSON file to {language}.
Remember: return ONLY valid JSON, nothing else.

{original_text}"""

    # Próby z retry
    last_error = ""
    for attempt in range(1, retries + 1):
        try:
            response = client.messages.create(
                model=DEFAULT_MODEL,
                max_tokens=DEFAULT_MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
            )

            raw = response.content[0].text
            cleaned = strip_code_fences(raw)

            # Parsuj JSON
            translated_data = json.loads(cleaned)

            # Walidacja
            errors = validate_translation(original_data, translated_data)
            if errors:
                err_str = "\n  ".join(errors)
                if attempt < retries:
                    print(f"    ⚠  Walidacja nieudana (próba {attempt}/{retries}), ponawiam...")
                    print(f"       {err_str[:200]}")
                    time.sleep(REQUEST_DELAY_SECS * 2)
                    continue
                else:
                    return False, f"Walidacja nieudana po {retries} próbach:\n  {err_str}"

            # Dry run — tylko pokaż, nie zapisuj
            if dry_run:
                new_title = translated_data.get("title", "?")
                return True, f'[DRY RUN] "{scenario_title}" → "{new_title}"'

            # Backup oryginału (tylko gdy nadpisujemy in-place)
            if output_path == input_path:
                backup_file(input_path)

            # Zapisz wynik
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(
                json.dumps(translated_data, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )

            new_title = translated_data.get("title", "?")
            return True, f'"{scenario_title}" → "{new_title}"'

        except json.JSONDecodeError as e:
            last_error = f"Nieprawidłowy JSON od API (próba {attempt}): {e}"
            if attempt < retries:
                print(f"    ⚠  {last_error}, ponawiam...")
                time.sleep(REQUEST_DELAY_SECS * 2)
        except anthropic.RateLimitError:
            wait = 30 * attempt
            print(f"    ⏳ Rate limit — czekam {wait}s...")
            time.sleep(wait)
        except anthropic.APIError as e:
            last_error = f"Błąd API Anthropic: {e}"
            if attempt < retries:
                print(f"    ⚠  {last_error}, ponawiam...")
                time.sleep(REQUEST_DELAY_SECS * 3)

    return False, last_error


# ─── Główna logika ─────────────────────────────────────────────────────────────

def run_translation(args):
    # Sprawdź klucz API
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("❌  Brak klucza API.")
        print("    Ustaw zmienną środowiskową:")
        print("    export ANTHROPIC_API_KEY='sk-ant-...'")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    scenarios_dir = Path(args.scenarios_dir)
    if not scenarios_dir.exists():
        print(f"❌  Katalog scenariuszy nie istnieje: {scenarios_dir}")
        sys.exit(1)

    # Katalog wyjściowy
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = None  # in-place

    # Zbierz pliki do tłumaczenia
    if args.file:
        files = [scenarios_dir / args.file]
        if not files[0].exists():
            print(f"❌  Plik nie istnieje: {files[0]}")
            sys.exit(1)
    else:
        files = sorted(scenarios_dir.glob("*.json"))

    if not files:
        print(f"❌  Brak plików JSON w katalogu: {scenarios_dir}")
        sys.exit(1)

    # Wczytaj postęp (dla --resume)
    progress_path = Path(PROGRESS_FILE)
    progress = load_progress(progress_path) if args.resume else {
        "completed": {}, "failed": {}, "started_at": datetime.now().isoformat()
    }

    # Filtruj już ukończone (--resume)
    if args.resume and progress["completed"]:
        files_to_do = [f for f in files if f.name not in progress["completed"]]
        skipped = len(files) - len(files_to_do)
        if skipped:
            print(f"⏭  Pomijam {skipped} już przetłumaczonych plików (--resume)")
        files = files_to_do

    total = len(files)
    if total == 0:
        print("✅  Wszystkie pliki już przetłumaczone!")
        return

    # Nagłówek
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║       KubeKosh Scenario Translator                  ║")
    print("╚══════════════════════════════════════════════════════╝")
    print(f"  Język docelowy : {args.lang}")
    print(f"  Model          : {DEFAULT_MODEL}")
    print(f"  Katalog źródłowy: {scenarios_dir}")
    print(f"  Katalog wyjściowy: {output_dir or 'in-place (z backupem .bak)'}")
    print(f"  Pliki do przetworzenia: {total}")
    print(f"  Tryb dry-run   : {'TAK' if args.dry_run else 'NIE'}")
    print(f"  Wznawianie     : {'TAK' if args.resume else 'NIE'}")
    print()

    if not args.dry_run and not args.yes:
        confirm = input(f"  Przetłumaczyć {total} plików? [t/N] ").strip().lower()
        if confirm not in ("t", "tak", "y", "yes"):
            print("  Anulowano.")
            return
    print()

    # ── Tłumaczenie sekwencyjne lub równoległe ─────────────────────────────────

    success_count = 0
    fail_count = 0
    start_time = time.time()

    def process_file(i_file):
        i, f = i_file
        out_path = (output_dir / f.name) if output_dir else f
        ok, msg = translate_file(
            client, f, out_path, args.lang,
            dry_run=args.dry_run,
            retries=3,
        )
        return i, f.name, ok, msg

    if args.workers > 1:
        print(f"  Tryb równoległy: {args.workers} wątki\n")
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(process_file, (i, f)): f
                for i, f in enumerate(files, 1)
            }
            for future in concurrent.futures.as_completed(futures):
                i, fname, ok, msg = future.result()
                _print_result(i, total, fname, ok, msg)
                if ok:
                    success_count += 1
                    progress["completed"][fname] = datetime.now().isoformat()
                else:
                    fail_count += 1
                    progress["failed"][fname] = msg
                save_progress(progress_path, progress)
    else:
        for i, f in enumerate(files, 1):
            _, fname, ok, msg = process_file((i, f))
            _print_result(i, total, fname, ok, msg)
            if ok:
                success_count += 1
                progress["completed"][fname] = datetime.now().isoformat()
            else:
                fail_count += 1
                progress["failed"][fname] = msg
            save_progress(progress_path, progress)

            # Rate limiting między requestami
            if i < total:
                time.sleep(REQUEST_DELAY_SECS)

    # ── Podsumowanie ────────────────────────────────────────────────────────────

    elapsed = time.time() - start_time
    print()
    print("═" * 56)
    print(f"  ✅  Sukces : {success_count}/{total}")
    if fail_count:
        print(f"  ❌  Błędy  : {fail_count}/{total}")
    print(f"  ⏱   Czas   : {elapsed:.1f}s ({elapsed/max(total,1):.1f}s/plik)")
    print()

    if fail_count:
        print("  Nieudane pliki:")
        for fname, err in progress["failed"].items():
            print(f"    - {fname}: {err[:120]}")
        print()
        print(f"  Wznów tłumaczenie nieudanych plików komendą:")
        print(f"    python {sys.argv[0]} --resume --lang {args.lang}")

    if not args.dry_run:
        print(f"  Plik postępu: {progress_path}")

    print()


def _print_result(i: int, total: int, fname: str, ok: bool, msg: str):
    icon = "✅" if ok else "❌"
    pct = f"{i/total*100:5.1f}%"
    short_name = fname.replace(".json", "")
    print(f"  [{i:02d}/{total}] {pct} {icon}  {short_name:<40}  {msg}")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Tłumaczy scenariusze KubeKosh za pomocą Anthropic API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Przykłady użycia:
  # Tłumaczenie na polski (domyślnie, in-place):
  python translate_scenarios.py

  # Do oddzielnego katalogu:
  python translate_scenarios.py --output-dir ./scenarios/pl

  # Tylko jeden plik:
  python translate_scenarios.py --file broken-deployment.json

  # Inny język:
  python translate_scenarios.py --lang german
  python translate_scenarios.py --lang "spanish (Latin America)"

  # Dry run — podgląd bez zapisu:
  python translate_scenarios.py --dry-run

  # Wznawianie przerwanej sesji:
  python translate_scenarios.py --resume

  # Równoległe (szybsze, ale uważaj na rate limits):
  python translate_scenarios.py --workers 3

  # Bez pytania o potwierdzenie (do automatyzacji):
  python translate_scenarios.py --yes
        """,
    )
    parser.add_argument(
        "--scenarios-dir",
        default=DEFAULT_SCENARIOS_DIR,
        help=f"Katalog z plikami JSON scenariuszy (domyślnie: {DEFAULT_SCENARIOS_DIR})",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Katalog wyjściowy (domyślnie: in-place, z backupem .bak)",
    )
    parser.add_argument(
        "--lang",
        default=DEFAULT_LANGUAGE,
        help="Język docelowy (domyślnie: polish)",
    )
    parser.add_argument(
        "--file",
        default=None,
        help="Przetłumacz tylko ten jeden plik (np. broken-deployment.json)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Pokaż co zostałoby zrobione bez zapisywania plików",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Wznów przerwaną sesję (pomiń już przetłumaczone pliki)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"Liczba równoległych wątków (domyślnie: {DEFAULT_WORKERS})",
    )
    parser.add_argument(
        "--yes", "-y",
        action="store_true",
        help="Pomiń pytanie o potwierdzenie",
    )

    args = parser.parse_args()
    run_translation(args)


if __name__ == "__main__":
    main()
