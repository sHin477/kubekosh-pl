import { useState, useMemo } from 'react'
import styles from './Sidebar.module.css'

const DIFF_COLOR = { Easy: 'green', Medium: 'amber', Hard: 'red' }
const DIFF_PL = { Easy: 'Łatwy', Medium: 'Średni', Hard: 'Trudny' }
const TYPE_ICON  = { task: '⚙', mcq: '◉' }

async function resetProgress(scope, opts) {
  await fetch('/api/progress/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, ...opts }),
  })
}

export default function Sidebar({
  scenarios, activeId, onSelect, loading,
  collapsed, onToggleCollapse, width,
  activeBundleId, onProgressUpdate,
}) {
  const [filterDiff, setFilterDiff] = useState('All')
  const [filterType, setFilterType] = useState('All')

  const filteredScenarios = useMemo(() => {
    return scenarios.filter(s => {
      if (filterDiff !== 'All' && s.difficulty !== filterDiff) return false
      if (filterType !== 'All' && s.type !== filterType) return false
      return true
    })
  }, [scenarios, filterDiff, filterType])

  const groups = useMemo(() => {
    const map = {}
    filteredScenarios.forEach(s => {
      if (!map[s.category]) map[s.category] = []
      map[s.category].push(s)
    })
    return map
  }, [filteredScenarios])

  const scenarioIndex = useMemo(() => {
    const map = {}
    scenarios.forEach(s => {
      if (!map[s.category]) map[s.category] = []
      map[s.category].push(s)
    })
    const idx = {}
    let counter = 1
    Object.values(map).forEach(items => {
      items.forEach(s => { idx[s.id] = counter++ })
    })
    return idx
  }, [scenarios])

  const [open, setOpen] = useState({})

  useMemo(() => {
    if (!activeId) return
    const s = scenarios.find(x => x.id === activeId)
    if (s) setOpen(o => ({ ...o, [s.category]: true }))
  }, [activeId, scenarios])

  const toggle = cat => setOpen(o => ({ ...o, [cat]: !o[cat] }))
  const totalDone = scenarios.filter(s => s.progress?.status === 'completed').length

  const handleCategoryReset = async (e, cat) => {
    e.stopPropagation()
    if (!window.confirm(`Zresetować wszystkie postępy w kategorii „${cat}"?`)) return
    await resetProgress('category', { category: cat })
    onProgressUpdate?.()
  }

  const handleScenarioReset = async (e, scenarioId, title) => {
    e.stopPropagation()
    if (!window.confirm(`Zresetować postęp dla „${title}"?`)) return
    await resetProgress('scenario', { scenarioId })
    onProgressUpdate?.()
  }

  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}
      style={{ width, minWidth: width }}
    >
      {/* Pasek górny */}
      <div className={styles.sidebarTop}>
        {!collapsed && <span className={styles.sidebarTitle}>Scenariusze</span>}
        {!collapsed && <span className={styles.sidebarCount}>{totalDone}/{scenarios.length}</span>}
        <button
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          title={collapsed ? 'Rozwiń panel boczny' : 'Zwiń panel boczny'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Pasek filtrów */}
      {!collapsed && (
        <div className={styles.filterBar}>
          <select
            value={filterDiff}
            onChange={e => setFilterDiff(e.target.value)}
            className={`${styles.selectFilter} ${filterDiff !== 'All' ? styles[DIFF_COLOR[filterDiff]] : ''}`}
          >
            <option value="All">Wszystkie poziomy</option>
            <option value="Easy">Łatwy</option>
            <option value="Medium">Średni</option>
            <option value="Hard">Trudny</option>
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className={`${styles.selectFilter} ${filterType !== 'All' ? styles[filterType] : ''}`}
          >
            <option value="All">Wszystkie typy</option>
            <option value="task">Zadanie</option>
            <option value="mcq">Wybór wielokrotny</option>
          </select>
        </div>
      )}

      {/* Lista */}
      {!collapsed && (
        <div className={styles.list}>
          {loading && (
            <div className={styles.loadingWrap}>
              {[...Array(5)].map((_, i) => (
                <div key={i} className={styles.skeleton} style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          )}

          {!loading && Object.entries(groups).map(([cat, items]) => {
            const catDone = items.filter(s => s.progress?.status === 'completed').length
            const isOpen = open[cat] !== false
            const hasCatProgress = items.some(s => s.progress?.attempts > 0)

            return (
              <div key={cat} className={styles.group}>
                <button className={styles.accordion} onClick={() => toggle(cat)}>
                  <div className={styles.accordionLeft}>
                    <span className={`${styles.chevron} ${isOpen ? styles.open : ''}`}>›</span>
                    <span className={styles.catName}>{cat}</span>
                  </div>
                  <div className={styles.accordionRight}>
                    <span className={styles.catCount}>{catDone}/{items.length}</span>
                    {hasCatProgress && (
                      <button
                        className={styles.catResetBtn}
                        title={`Resetuj wszystkie postępy w „${cat}"`}
                        onClick={e => handleCategoryReset(e, cat)}
                      >
                        ↺
                      </button>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className={styles.itemsBox}>
                    {items.map(s => {
                      const done = s.progress?.status === 'completed'
                      const active = s.id === activeId
                      const hasAttempts = s.progress?.attempts > 0
                      return (
                        <button
                          key={s.id}
                          className={`${styles.item} ${active ? styles.active : ''} ${done ? styles.done : ''}`}
                          onClick={() => onSelect(s.id)}
                        >
                          <div className={styles.itemTop}>
                            <span className={styles.itemNum}>{scenarioIndex[s.id]}</span>
                            <span className={styles.typeIcon}>{TYPE_ICON[s.type] || '•'}</span>
                            <span className={styles.itemTitle}>{s.title}</span>
                            {done && <span className={styles.checkmark}>✓</span>}
                            {hasAttempts && (
                              <button
                                className={styles.itemResetBtn}
                                title="Resetuj postęp tego scenariusza"
                                onClick={e => handleScenarioReset(e, s.id, s.title)}
                              >
                                ↺
                              </button>
                            )}
                          </div>
                          <div className={styles.itemMeta}>
                            <span className={`${styles.diff} ${styles[DIFF_COLOR[s.difficulty]]}`}>
                              {DIFF_PL[s.difficulty] || s.difficulty}
                            </span>
                            <span className={`${styles.type} ${styles[s.type]}`}>
                              {s.type === 'task' ? 'ZADANIE' : 'WW'}
                            </span>
                            <span className={styles.weight}>{s.weight}pkt</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
