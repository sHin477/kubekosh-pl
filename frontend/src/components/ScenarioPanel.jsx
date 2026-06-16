import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './ScenarioPanel.module.css'

const inlineComponents = {
  p: ({ children }) => <>{children}</>,
  code: ({ children }) => <code className="inline-code">{children}</code>,
}
function InlineMd({ children }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineComponents}>
      {children}
    </ReactMarkdown>
  )
}

async function resetProgress(scope, opts) {
  await fetch('/api/progress/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, ...opts }),
  })
}

export default function ScenarioPanel({ scenario, onProgressUpdate, onScenarioStart, isExamMode }) {
  const [tab, setTab] = useState('problem')
  const [setupState, setSetupState] = useState('idle')
  const [validating, setValidating] = useState(false)
  const [validResult, setValidResult] = useState(null)
  const [selectedOption, setSelectedOption] = useState(null)
  const [mcqResult, setMcqResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [hintsRevealed, setHintsRevealed] = useState([])
  const [copiedCmd, setCopiedCmd] = useState(null)
  const [localTimeSpent, setLocalTimeSpent] = useState(0)

  useEffect(() => {
    setTab('problem')
    setSetupState('idle')
    setValidResult(null)
    setSelectedOption(null)
    setMcqResult(null)
    setHintsRevealed([])
  }, [scenario?.id])

  const timeSpentRef = useRef(0)
  const lastScenarioIdRef = useRef(null)

  useEffect(() => {
    const propTime = scenario?.progress?.time_spent_seconds || 0
    if (lastScenarioIdRef.current !== scenario?.id) {
      lastScenarioIdRef.current = scenario?.id
      timeSpentRef.current = propTime
      setLocalTimeSpent(propTime)
    } else if (propTime > timeSpentRef.current) {
      timeSpentRef.current = propTime
      setLocalTimeSpent(propTime)
    }
  }, [scenario?.id, scenario?.progress?.time_spent_seconds])

  const prevIsExamModeRef = useRef(isExamMode)

  useEffect(() => {
    if (prevIsExamModeRef.current && !isExamMode) {
      timeSpentRef.current = 0
      setLocalTimeSpent(0)
    }
    prevIsExamModeRef.current = isExamMode
  }, [isExamMode])

  useEffect(() => {
    if (!isExamMode || !scenario || scenario.progress?.status === 'completed') return

    if (!scenario.progress?.started_at) {
      fetch(`/api/scenarios/${scenario.id}/time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time_spent_seconds: timeSpentRef.current })
      }).then(() => {
        onProgressUpdate?.()
      }).catch(() => {})
    }

    const timer = setInterval(() => {
      timeSpentRef.current += 1
      setLocalTimeSpent(timeSpentRef.current)
      if (timeSpentRef.current % 10 === 0) {
        fetch(`/api/scenarios/${scenario.id}/time`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ time_spent_seconds: timeSpentRef.current })
        }).catch(() => {})
      }
    }, 1000)

    return () => {
      clearInterval(timer)
      fetch(`/api/scenarios/${scenario.id}/time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time_spent_seconds: timeSpentRef.current }),
        keepalive: true
      }).catch(() => {})
    }
  }, [scenario?.id, scenario?.progress?.status, isExamMode, onProgressUpdate])

  async function runSetup() {
    setSetupState('running')
    try {
      await fetch(`/api/scenarios/${scenario.id}/teardown`, { method: 'POST' }).catch(() => {})
      await onScenarioStart?.(scenario.id)
      await fetch(`/api/scenarios/${scenario.id}/setup`, { method: 'POST' })
      setSetupState('done')
    } catch {
      setSetupState('error')
    }
  }

  async function validate() {
    setValidating(true)
    setValidResult(null)
    try {
      const r = await fetch(`/api/scenarios/${scenario.id}/validate`, { method: 'POST' })
      const d = await r.json()
      setValidResult(d)
      onProgressUpdate()
    } catch {
      setValidResult({ error: true })
    }
    setValidating(false)
  }

  async function submitMCQ() {
    if (!selectedOption) return
    setSubmitting(true)
    try {
      const r = await fetch(`/api/scenarios/${scenario.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: selectedOption })
      })
      const d = await r.json()
      setMcqResult(d)
      onProgressUpdate()
    } catch {}
    setSubmitting(false)
  }

  function copyCmd(cmd, idx) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(cmd).then(() => {
        setCopiedCmd(idx)
        setTimeout(() => setCopiedCmd(null), 1800)
      })
    } else {
      const textArea = document.createElement("textarea")
      textArea.value = cmd
      textArea.style.position = "fixed"
      textArea.style.left = "-999999px"
      textArea.style.top = "-999999px"
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        document.execCommand('copy')
        setCopiedCmd(idx)
        setTimeout(() => setCopiedCmd(null), 1800)
      } catch (err) {
        console.error('Kopiowanie nie powiodło się', err)
      }
      textArea.remove()
    }
  }

  if (!scenario) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>⎈</div>
        <div className={styles.emptyTitle}>Wybierz scenariusz</div>
        <div className={styles.emptySub}>Wybierz scenariusz z lewego panelu, aby rozpocząć ćwiczenie</div>
      </div>
    )
  }

  const isCompleted = scenario.progress?.status === 'completed'

  return (
    <div className={styles.panel}>
      {/* Nagłówek scenariusza */}
      <div className={styles.scenarioHeader}>
        <div className={styles.scenarioMeta}>
          <span className={styles.category}>{scenario.category}</span>
          <span className={`${styles.diff} ${styles[scenario.difficulty?.toLowerCase()]}`}>
            {scenario.difficulty === 'Easy' ? 'Łatwy' : scenario.difficulty === 'Medium' ? 'Średni' : scenario.difficulty === 'Hard' ? 'Trudny' : scenario.difficulty}
          </span>
          <span className={styles.typeTag}>{scenario.type === 'mcq' ? 'Wybór Wielokrotny' : 'Zadanie Praktyczne'}</span>
          <span className={styles.weight}>{scenario.weight} pkt</span>
        </div>
        <div className={styles.titleRow}>
          <div className={styles.scenarioTitle}>{scenario.title}</div>
          {isExamMode && scenario.progress?.started_at && (
            <div className={styles.progressStats}>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Rozpoczęto:</span>
                <span className={styles.statVal}>
                  {new Date(scenario.progress.started_at).toLocaleString('pl-PL')}
                </span>
              </div>
              <span className={styles.statSeparator}>•</span>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Czas spędzony:</span>
                <span className={styles.statVal}>
                  {(() => {
                    const m = Math.floor(localTimeSpent / 60)
                    const s = localTimeSpent % 60
                    if (m > 0) return `${m} min ${s} s`
                    return `${s} s`
                  })()}
                </span>
              </div>
            </div>
          )}
          {scenario.progress?.status !== 'not_started' && scenario.progress?.attempts > 0 && (
            <button
              className={styles.resetBtn}
              title="Resetuj postęp dla tego scenariusza"
              onClick={async () => {
                const msg = scenario.type === 'task'
                  ? `Zresetować postęp i stan klastra dla „${scenario.title}"?\n\nSpowoduje to uruchomienie teardown w celu wyczyszczenia środowiska.`
                  : `Zresetować postęp dla „${scenario.title}"?`
                if (!window.confirm(msg)) return
                await resetProgress('scenario', { scenarioId: scenario.id })
                setSelectedOption(null)
                setMcqResult(null)
                setValidResult(null)
                setSetupState('idle')
                setHintsRevealed([])
                onProgressUpdate()
                if (scenario.type === 'task') {
                  await fetch(`/api/scenarios/${scenario.id}/teardown`, { method: 'POST' }).catch(() => {})
                }
              }}
            >
              ↺ Resetuj
            </button>
          )}
        </div>
        {isCompleted && (
          <div className={styles.completedBanner}>
            <span>✓</span> Scenariusz ukończony
          </div>
        )}
      </div>

      {/* Zakładki */}
      <div className={styles.tabs}>
        {['problem', ...(isExamMode ? [] : ['hints']), ...(scenario.type === 'task' && !isExamMode ? ['validate'] : [])].map(t => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.activeTab : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'problem' ? '📄 Zadanie'
              : t === 'hints' ? `💡 Wskazówki (${scenario.hints?.length || 0})`
              : '✓ Weryfikacja'}
          </button>
        ))}
      </div>

      {/* Zawartość zakładek */}
      <div className={styles.content}>

        {/* ZAKŁADKA ZADANIE */}
        {tab === 'problem' && (
          <div className={styles.tabPane} style={{ animation: 'fadeIn 0.2s ease' }}>

            {/* Sekcja konfiguracji (jeśli istnieją komendy konfiguracyjne) */}
            {scenario.setup_commands?.length > 0 && (
              <div className={styles.setupBox}>
                <div className={styles.setupHeader}>
                  <div className={styles.setupLabel}>
                    <span>⚡</span> Gotowy do startu?
                  </div>
                  {setupState === 'idle' && (
                    <button className={styles.setupBtn} onClick={runSetup}>
                      ▶ Rozpocznij Scenariusz
                    </button>
                  )}
                  {setupState === 'running' && (
                    <div className={styles.setupRunning}>
                      <span className={styles.spinner} />Konfigurowanie…
                    </div>
                  )}
                  {setupState === 'done' && (
                    <span className={styles.setupDone}>✓ Środowisko gotowe</span>
                  )}
                  {setupState === 'error' && (
                    <button className={styles.setupBtnRetry} onClick={runSetup}>⟳ Spróbuj ponownie</button>
                  )}
                </div>
                <div className={styles.setupNote}>
                  Kliknij <strong>Rozpocznij Scenariusz</strong>, aby skonfigurować środowisko laboratoryjne, a następnie rozwiąż poniższe zadanie.
                </div>
              </div>
            )}

            {/* Opis zadania */}
            <div className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{scenario.description}</ReactMarkdown>
            </div>

            {/* Opcje MCQ */}
            {scenario.type === 'mcq' && (
              <div className={styles.mcqSection}>
                <div className={styles.mcqLabel}>Wybierz odpowiedź:</div>
                <div className={styles.options}>
                  {scenario.options?.map(opt => {
                    const isSelected = selectedOption === opt.id
                    const showCorrect = mcqResult && opt.id === mcqResult.correct_option
                    const showWrong = mcqResult && isSelected && !mcqResult.correct
                    return (
                      <button
                        key={opt.id}
                        className={`${styles.option}
                          ${isSelected ? styles.optionSelected : ''}
                          ${showCorrect ? styles.optionCorrect : ''}
                          ${showWrong ? styles.optionWrong : ''}
                        `}
                        onClick={() => !mcqResult && setSelectedOption(opt.id)}
                        disabled={!!mcqResult}
                      >
                        <span className={styles.optionLetter}>{opt.id.toUpperCase()}</span>
                        <span className={styles.optionText}>
                          <InlineMd>{opt.text}</InlineMd>
                        </span>
                        {showCorrect && <span className={styles.optionMark}>✓</span>}
                        {showWrong && <span className={styles.optionMark}>✗</span>}
                      </button>
                    )
                  })}
                </div>

                {!mcqResult ? (
                  <button
                    className={styles.submitBtn}
                    onClick={submitMCQ}
                    disabled={!selectedOption || submitting}
                  >
                    {submitting ? 'Sprawdzanie…' : 'Zatwierdź odpowiedź'}
                  </button>
                ) : (
                  <div className={`${styles.mcqResult} ${mcqResult.correct ? styles.mcqCorrect : styles.mcqWrong}`}>
                    <div className={styles.mcqResultTitle}>
                      {mcqResult.correct ? '✓ Poprawnie!' : '✗ Niepoprawnie — sprawdź podświetloną odpowiedź powyżej'}
                    </div>
                    {mcqResult.explanation && (
                      <div className={styles.mcqExplanation}>
                        <InlineMd>{mcqResult.explanation}</InlineMd>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ZAKŁADKA WSKAZÓWKI */}
        {tab === 'hints' && (
          <div className={styles.tabPane} style={{ animation: 'fadeIn 0.2s ease' }}>
            {scenario.hints?.length === 0 && (
              <div className={styles.noHints}>Brak wskazówek dla tego scenariusza.</div>
            )}
            {scenario.hints?.map((hint, i) => {
              const revealed = hintsRevealed.includes(i)
              return (
                <div key={i} className={styles.hintCard}>
                  <div className={styles.hintHeader} onClick={() => setHintsRevealed(h => revealed ? h.filter(x => x !== i) : [...h, i])}>
                    <div className={styles.hintLeft}>
                      <span className={styles.hintNum}>Wskazówka {i + 1}</span>
                      <span className={styles.hintTitle}>{hint.title}</span>
                    </div>
                    <span className={styles.hintChevron}>{revealed ? '▾' : '▸'}</span>
                  </div>
                  {revealed && (
                    <div className={styles.hintBody} style={{ animation: 'fadeIn 0.15s ease' }}>
                      <p className={styles.hintText}>
                        <InlineMd>{hint.body}</InlineMd>
                      </p>
                      {hint.command && (
                        <div className={styles.cmdBlock}>
                          <pre className={styles.cmdPre}>{hint.command}</pre>
                          <button
                            className={styles.copyBtn}
                            onClick={() => copyCmd(hint.command, i)}
                          >
                            {copiedCmd === i ? '✓ Skopiowano' : 'Kopiuj'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ZAKŁADKA WERYFIKACJA */}
        {tab === 'validate' && scenario.type === 'task' && (
          <div className={styles.tabPane} style={{ animation: 'fadeIn 0.2s ease' }}>
            <div className={styles.validateHeader}>
              <div className={styles.validateDesc}>
                {scenario.validation?.description}
              </div>
              <button
                className={styles.validateBtn}
                onClick={validate}
                disabled={validating}
              >
                {validating
                  ? <><span className={styles.spinner} /> Uruchamianie sprawdzania…</>
                  : '▶ Uruchom Weryfikację'}
              </button>
            </div>

            {validResult && !validResult.error && (
              <div className={styles.checks}>
                <div className={`${styles.checksSummary} ${validResult.passed ? styles.allPassed : styles.someFailed}`}>
                  {validResult.passed
                    ? `✓ Wszystkie ${validResult.checks.length} sprawdzenia zaliczone!`
                    : `${validResult.checks.filter(c => !c.passed).length} z ${validResult.checks.length} sprawdzeń nie powiodło się`}
                  <span className={styles.attempts}>Próba #{validResult.attempts}</span>
                </div>
                {validResult.checks.map((c, i) => (
                  <div key={i} className={`${styles.check} ${c.passed ? styles.checkPass : styles.checkFail}`}>
                    <span className={styles.checkIcon}>{c.passed ? '✓' : '✗'}</span>
                    <div className={styles.checkContent}>
                      <div className={styles.checkDesc}>{c.description}</div>
                      {!c.passed && (
                        <div className={styles.checkDetail}>
                          <span>Oczekiwano: <code>{c.expected}</code></span>
                          <span>Otrzymano: <code>{c.actual || '(puste)'}</code></span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {validResult?.error && (
              <div className={styles.validateError}>⚠ Weryfikacja nie powiodła się. Czy klaster jest dostępny?</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
