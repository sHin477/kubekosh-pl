import { useState, useEffect, useCallback, useRef } from 'react'
import styles from './ExamTimer.module.css'

function formatTime(secs) {
  if (secs < 0) secs = 0
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

export default function ExamTimer({ session, bundle, onSubmit, onAbandon }) {
  const [elapsed, setElapsed] = useState(0)
  const autoSubmitted = useRef(false)
  const durationSecs = (session?.exam_minutes || bundle?.exam_minutes || 120) * 60

  useEffect(() => {
    if (!session) return
    autoSubmitted.current = false
    const startedAt = new Date(session.started_at + (session.started_at.endsWith('Z') ? '' : 'Z'))

    const tick = () => {
      const el = Math.floor((Date.now() - startedAt.getTime()) / 1000)
      if (el >= durationSecs && !autoSubmitted.current) {
        autoSubmitted.current = true
        setElapsed(durationSecs)
        onSubmit()
      } else if (!autoSubmitted.current) {
        setElapsed(el)
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [session, durationSecs, onSubmit])

  const remaining = durationSecs - elapsed
  const pct = Math.min(100, (elapsed / durationSecs) * 100)
  const urgent = remaining < 600

  const handleSubmit = useCallback(async () => {
    if (!window.confirm(`Zakończyć egzamin?\n\n${session.completedCount || 0} z ${session.scenarioCount || '?'} scenariuszy ukończonych.`)) return
    onSubmit()
  }, [session, onSubmit])

  const handleAbandon = useCallback(() => {
    if (!window.confirm('Porzucić egzamin?\n\nTwój postęp zostanie zapisany, ale raport wyników nie zostanie wygenerowany.')) return
    onAbandon()
  }, [onAbandon])

  if (!session) return null

  return (
    <div className={`${styles.timer} ${urgent ? styles.urgent : ''}`}>
      <div className={styles.left}>
        <span className={styles.icon}>⏱</span>
        <div className={styles.meta}>
          <span className={styles.label}>TRYB EGZAMINU</span>
          <span className={styles.bundleName}>{bundle?.name}</span>
        </div>
      </div>

      <div className={styles.center}>
        <div className={styles.timeDisplay}>
          <span className={styles.elapsed}>{formatTime(elapsed)}</span>
          <span className={styles.sep}>/</span>
          <span className={styles.total}>{formatTime(durationSecs)}</span>
          {urgent && <span className={styles.urgentTag}>⚠ Kończy się czas</span>}
        </div>
        <div className={styles.bar}>
          <div className={styles.fill} style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.progress}>
          {session.completedCount || 0} / {session.scenarioCount || '?'} ukończonych
        </div>
      </div>

      <div className={styles.right}>
        <button className={styles.abandonBtn} onClick={handleAbandon} title="Porzuć egzamin (bez raportu wyników)">
          ✕ Porzuć
        </button>
        <button className={styles.submitBtn} onClick={handleSubmit}>
          ✓ Zakończ Egzamin
        </button>
      </div>
    </div>
  )
}
