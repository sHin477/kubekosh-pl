import { useState, useRef } from 'react'
import styles from './BundleNav.module.css'

async function resetProgress(scope, opts) {
  await fetch('/api/progress/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, ...opts }),
  })
}

export default function BundleNav({
  bundles, activeBundleId, examSession, onSelect, onProgressUpdate, onStartExam, collapsed, onToggleCollapse
}) {
  const trackRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [dragDist, setDragDist] = useState(0)

  const handleMouseDown = (e) => {
    if (!trackRef.current) return
    setIsDragging(true)
    setDragDist(0)
    setStartX(e.pageX - trackRef.current.offsetLeft)
    setScrollLeft(trackRef.current.scrollLeft)
  }

  const handleMouseLeaveOrUp = () => { setIsDragging(false) }

  const handleMouseMove = (e) => {
    if (!isDragging || !trackRef.current) return
    e.preventDefault()
    const x = e.pageX - trackRef.current.offsetLeft
    const walk = x - startX
    if (Math.abs(walk) > 5) setDragDist(Math.abs(walk))
    trackRef.current.scrollLeft = scrollLeft - walk
  }

  return (
    <>
      <nav className={`${styles.nav} ${collapsed ? styles.collapsed : ''}`} aria-label="Zestawy scenariuszy">
        {!collapsed && (
          <div
            className={`${styles.track} ${(isDragging && dragDist > 5) ? styles.dragging : ''}`}
            ref={trackRef}
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseLeaveOrUp}
            onMouseUp={handleMouseLeaveOrUp}
            onMouseMove={handleMouseMove}
          >
            {bundles.map(b => {
              const active = b.id === activeBundleId
              const isExamBundle = examSession?.bundle_id === b.id
              const lockedByExam = examSession && !isExamBundle
              const pct = b.stats.total > 0
                ? Math.round((b.stats.completed / b.stats.total) * 100)
                : 0

              return (
                <button
                  key={b.id}
                  className={`${styles.tab} ${active ? styles.active : ''} ${lockedByExam ? styles.locked : ''}`}
                  style={{ '--bcolor': b.color, '--bdim': b.colorDim }}
                  onClick={(e) => {
                    if (dragDist > 5) { e.preventDefault(); e.stopPropagation(); return }
                    if (!lockedByExam) onSelect(b.id)
                  }}
                  aria-pressed={active}
                  title={lockedByExam ? 'Porzuć bieżący egzamin, aby przełączyć zestawy' : b.tagline}
                >
                  <div className={styles.tabTop}>
                    <span className={styles.icon}>{b.icon}</span>
                    <div className={styles.text}>
                      <span className={styles.name}>{b.name}</span>
                      <span className={styles.tagline}>{b.tagline}</span>
                    </div>
                    <div className={styles.countWrap}>
                      <span className={styles.countNum}>{b.stats.completed}/{b.stats.total}</span>
                      <span className={styles.countPct}>{pct}%</span>
                    </div>

                    {!examSession && !lockedByExam && (
                      <button
                        className={styles.examBtn}
                        title={`Rozpocznij egzamin czasowy dla „${b.name}" (zalecane: ${b.exam_minutes ?? 120} min)`}
                        onClick={e => { e.stopPropagation(); onStartExam?.(b) }}
                      >
                        ▶ Egzamin
                      </button>
                    )}

                    {isExamBundle && (
                      <span className={styles.examBadge}>🏁 W trakcie</span>
                    )}

                    {b.stats.completed > 0 && !examSession && (
                      <button
                        className={styles.bundleResetBtn}
                        title={`Resetuj wszystkie postępy w „${b.name}"`}
                        onClick={async e => {
                          e.stopPropagation()
                          if (!window.confirm(`Zresetować wszystkie postępy w „${b.name}"?`)) return
                          await resetProgress('bundle', { bundleId: b.id })
                          onProgressUpdate?.()
                        }}
                      >
                        ↺
                      </button>
                    )}
                  </div>

                  <div className={styles.progressTrack}>
                    <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                  </div>
                </button>
              )
            })}
          </div>
        )}
        {!collapsed && <div className={styles.fadeOverlay} />}
        <div
          className={styles.collapseWrap}
          onClick={onToggleCollapse}
          title={collapsed ? 'Pokaż zestawy' : 'Ukryj zestawy'}
        >
          {collapsed ? '▼' : '▲'}
        </div>
      </nav>
    </>
  )
}
