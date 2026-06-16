🇵🇱 Polska wersja językowa projektu zeborg/kubekosh. Interfejs użytkownika przetłumaczony na język polski — pełna funkcjonalność bez zmian.

<p align="center">
  <a href="https://github.com/zeborg/kubekosh">
    <img src="assets/logo.svg" alt="KubeKosh" width="600"/>
  </a>
</p>

KubeKosh uruchamia prawdziwy klaster K3s Kubernetes wewnątrz pojedynczego kontenera Docker i łączy go z terminalem przeglądarkowym oraz automatyczną weryfikacją scenariuszy — bez potrzeby posiadania konta w chmurze czy lokalnego klastra.

# KubeKosh PL — Instrukcja instalacji i użytkowania

## Co zostało przetłumaczone

| Plik | Zmiany |
|---|---|
| `frontend/src/App.jsx` | Komentarze, stopka, tytuł |
| `frontend/src/components/Header.jsx` | Tagline, statusy klastra, komunikaty błędów |
| `frontend/src/components/Sidebar.jsx` | Tytuł „Scenariusze", filtry (poziomy, typy), etykiety przycisków |
| `frontend/src/components/ScenarioPanel.jsx` | Zakładki (Zadanie/Wskazówki/Weryfikacja), komunikaty walidacji, MCQ |
| `frontend/src/components/BundleNav.jsx` | Zestawy, egzamin, postępy |
| `frontend/src/components/ExamTimer.jsx` | Timer, przyciski Zakończ/Porzuć |
| `frontend/src/components/ExamReport.jsx` | Raport wyników, kategorie, wyniki |
| `frontend/src/components/ExamStartModal.jsx` | Modal startu egzaminu |
| `frontend/src/components/Terminal.jsx` | Komunikaty połączenia/rozłączenia |
| `scenarios/bundles/*.json` | Nazwy i opisy zestawów |
| `scenarios/data/*.json` | Tytuły, opisy, wskazówki i opcje wszystkich 85 scenariuszy |
| `README.md` | Pełne tłumaczenie dokumentacji |

---
![Zrzut ekranu](https://github.com/sHin477/kubekosh-pl/blob/main/KubeKosh-pl.png)
---
## Instalacja

### Wymagania wstępne

- **Docker** zainstalowany i działający: https://docs.docker.com/get-docker/
- Terminal (Terminal na Mac/Linux)

---

### Krok 1 — Pobierz obraz z Docker Hub

Obraz jest gotowy do użycia — nie trzeba niczego budować:

```bash
sudo docker pull daniel4777/kubekosh-pl:latest
```

---

### Krok 2 — Uruchom kontener

```bash
sudo docker run -d --privileged --name kubekosh -p 7554:80 daniel4777/kubekosh-pl:latest
```

> **Uwaga:** `--privileged` jest wymagane — K3s potrzebuje dostępu do jądra systemu.

Sprawdź czy kontener działa:

```bash
sudo docker ps | grep kubekosh
```

---

### Krok 3 — Otwórz w przeglądarce

Przejdź na: **http://localhost:7554**

Poczekaj **~30 sekund** aż wskaźnik **„Klaster Gotowy"** (w prawym górnym rogu) zmieni kolor na zielony.

---

### Krok 4 — Zatrzymaj kontener po testach

```bash
sudo docker stop kubekosh
sudo docker rm kubekosh
```

---

### Opcjonalnie: Zachowywanie postępów między sesjami

Jeśli chcesz, aby postępy nie znikały po restarcie kontenera, zamontuj lokalny katalog:

```bash
sudo docker run -d --privileged --name kubekosh -p 7554:80 \
  -v "$HOME/kubekosh-data:/data" daniel4777/kubekosh-pl:latest
```

Postępy są przechowywane w SQLite pod ścieżką `/data/progress.db` wewnątrz kontenera.

---

### Opcjonalnie: Gorące przeładowanie scenariuszy (bez przebudowy)

Jeśli edytujesz scenariusze lokalnie i chcesz zobaczyć zmiany bez przebudowywania obrazu:

```bash
sudo docker run -d --privileged --name kubekosh -p 7554:80 \
  -v "$PWD/scenarios:/app/scenarios" daniel4777/kubekosh-pl:latest
```

Następnie po edycji pliku JSON kliknij przycisk **↻** (Odśwież pamięć podręczną) w prawym górnym rogu aplikacji.

---


```

Następnie użytkownicy uruchomią projekt jedną komendą:


sudo docker run -d --privileged --name kubekosh -p 7554:80 daniel4777/kubekosh-pl:latest
```

---

## Rozwiązywanie problemów

### Docker: „permission denied" lub błąd uprawnień
Użyj `sudo` przed każdą komendą docker lub dodaj użytkownika do grupy docker (Linux):
```bash
sudo usermod -aG docker $USER
# Wyloguj się i zaloguj ponownie — po tym sudo nie będzie potrzebne
```

### Kontener o nazwie „kubekosh" już istnieje
```bash
sudo docker rm -f kubekosh
sudo docker run -d --privileged --name kubekosh -p 7554:80 daniel4777/kubekosh-pl:latest
```

### Klaster nie startuje (wskaźnik pozostaje szary)
K3s potrzebuje kilku minut. Sprawdź logi:
```bash
sudo docker logs kubekosh
```
Poszukaj linii `K3s is ready` lub `cluster is ready`.

### Port 7554 zajęty
Zmień port hosta (pierwsza liczba):
```bash
sudo docker run -d --privileged --name kubekosh -p 8080:80 daniel4777/kubekosh-pl:latest
# Otwórz: http://localhost:8080
```
Serdecznie zapraszam do zapisów na nasze kursy https://grupadm.pl/
