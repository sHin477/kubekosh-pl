import styles from './ExamReport.module.css'

function formatDuration(secs) {
  if (!secs) return '—'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h} godz. ${m} min ${s} s`
  if (m > 0) return `${m} min ${s} s`
  return `${s} s`
}

const DIFF_COLOR = { Easy: 'var(--green)', Medium: 'var(--amber)', Hard: 'var(--red)' }
const DIFF_PL = { Easy: 'Łatwy', Medium: 'Średni', Hard: 'Trudny' }

export default function ExamReport({ report, bundle, onClose, onRetry }) {
  if (!report) return null

  const { snapshot, durationSecs } = report
  const completed = snapshot.filter(s => s.status === 'completed')
  const totalWeight = snapshot.reduce((a, s) => a + (s.weight || 0), 0)
  const earnedWeight = completed.reduce((a, s) => a + (s.weight || 0), 0)
  const pct = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0

  const byCategory = snapshot.reduce((acc, s) => {
    ;(acc[s.category] = acc[s.category] || []).push(s)
    return acc
  }, {})

  const passed = pct >= 66

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        {/* Nagłówek */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.bundleIcon}>{bundle?.icon || '🎓'}</span>
            <div>
              <div className={styles.examLabel}>Raport Egzaminu</div>
              <div className={styles.bundleName}>{bundle?.name}</div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Wynik */}
        <div className={`${styles.hero} ${passed ? styles.passed : styles.failed}`}>
          <div className={styles.scoreRing}>
            <svg viewBox="0 0 80 80" className={styles.ring}>
              <circle cx="40" cy="40" r="34" className={styles.ringTrack} />
              <circle
                cx="40" cy="40" r="34"
                className={styles.ringFill}
                strokeDasharray={`${2 * Math.PI * 34}`}
                strokeDashoffset={`${2 * Math.PI * 34 * (1 - pct / 100)}`}
                style={{ stroke: passed ? 'var(--green)' : 'var(--red)' }}
              />
            </svg>
            <span className={styles.pctText}>{pct}%</span>
          </div>
          <div className={styles.heroMeta}>
            <div className={`${styles.verdict} ${passed ? styles.verdictPass : styles.verdictFail}`}>
              {passed ? '✅ Zaliczono' : '❌ Niezaliczone'}
            </div>
            <div className={styles.heroStats}>
              <span>{completed.length}/{snapshot.length} scenariuszy</span>
              <span>·</span>
              <span>{earnedWeight}/{totalWeight} punktów</span>
              <span>·</span>
              <span>⏱ {formatDuration(durationSecs)}</span>
            </div>
            <div className={styles.passMark}>Próg zaliczenia: 66%</div>
          </div>
        </div>

        {/* Podział na kategorie */}
        <div className={styles.breakdown}>
          {Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat} className={styles.catGroup}>
              <div className={styles.catTitle}>{cat}</div>
              {items.map(s => (
                <div key={s.id} className={`${styles.row} ${s.status === 'completed' ? styles.rowDone : ''}`}>
                  <span className={styles.rowIcon}>{s.status === 'completed' ? '✅' : '⬜'}</span>
                  <span className={styles.rowTitle}>{s.title}</span>
                  <span className={styles.rowDiff} style={{ color: DIFF_COLOR[s.difficulty] }}>
                    {DIFF_PL[s.difficulty] || s.difficulty}
                  </span>
                  <span className={styles.rowPts}>{s.status === 'completed' ? s.weight : 0}/{s.weight} pkt</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Akcje */}
        <div className={styles.actions}>
          <button className={styles.retryBtn} onClick={onRetry}>🔄 Rozpocznij Nowy Egzamin</button>
          <button className={styles.closeBtn2} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  )
}
