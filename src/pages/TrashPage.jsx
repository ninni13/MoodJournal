import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'
import { db } from '../lib/firebase.js'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toEpoch(dateStr) {
  if (!dateStr) return 0
  const norm = String(dateStr).slice(0, 10).replaceAll('/', '-')
  const t = Date.parse(`${norm}T00:00:00`)
  return Number.isNaN(t) ? 0 : t
}

function formatDisplayDate(dateStr) {
  const norm = String(dateStr).replaceAll('-', '/')
  return norm
}

export default function TrashPage() {
  const { currentUser } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const baseCol = useMemo(() => {
    if (!currentUser) return null
    return collection(db, 'users', currentUser.uid, 'diaries')
  }, [currentUser])

  const refresh = useCallback(async () => {
    if (!baseCol) return
    setLoading(true)
    setError('')
    try {
      // Avoid composite index: order only; filter client-side
      const q1 = query(baseCol, orderBy('date', 'desc'))
      const snap = await getDocs(q1)
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const normalized = list.map(e => ({
        id: e.id,
        date: String(e.date || todayKey()).slice(0, 10).replaceAll('/', '-'),
        content: String(e.content ?? ''),
        isDeleted: Boolean(e.isDeleted),
      }))
      const filtered = normalized.filter(e => e.isDeleted === true)
      filtered.sort((a, b) => toEpoch(b.date) - toEpoch(a.date))
      setEntries(filtered)
    } catch (e) {
      console.error(e)
      setError(e?.message || '讀取資料失敗')
    } finally {
      setLoading(false)
    }
  }, [baseCol])

  useEffect(() => { refresh() }, [refresh])

  async function restore(id) {
    try {
      await updateDoc(doc(baseCol, id), { isDeleted: false, updatedAt: new Date().toISOString() })
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch (e) {
      console.error(e)
      setError(e?.message || '還原失敗')
    }
  }

  async function hardDelete(id) {
    const ok = window.confirm('永久刪除後無法復原，確定要刪除嗎？')
    if (!ok) return
    try {
      await deleteDoc(doc(baseCol, id))
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch (e) {
      console.error(e)
      setError(e?.message || '刪除失敗')
    }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="title" style={{ marginBottom: 0 }}>垃圾桶</h1>
        <div>
          <Link to="/" style={{ marginRight: '0.75rem', fontSize: 14 }}>返回日記</Link>
        </div>
      </div>

      <div className="list">
        <h2 className="subtitle">已刪除的日記</h2>
        {loading ? (
          <p className="empty">載入中…</p>
        ) : entries.length === 0 ? (
          <p className="empty">目前垃圾桶是空的</p>
        ) : (
          <ul className="entries">
            {entries.map((e) => (
              <li key={e.id} className="entry">
                <div className="entry-main">
                  <span className="entry-date">{formatDisplayDate(e.date)}</span>
                  <span className="entry-sep">|</span>
                  <span className="entry-summary">{String(e.content).slice(0, 30)}{String(e.content).length > 30 ? '…' : ''}</span>
                  {/* Optional: show sentiment tag if exists */}
                  {e.sentiment && (
                    <>
                      {(() => {
                        const s = e.sentiment || {}
                        const label = s.label || 'neutral'
                        const conf = typeof s.confidence === 'number' ? s.confidence : undefined
                        const cls = label === 'positive' ? 'chip-positive' : (label === 'negative' ? 'chip-negative' : 'chip-neutral')
                        const showKw = label === 'positive' || label === 'negative'
                        const title = conf !== undefined ? `${label} (信心 ${(conf * 100).toFixed(1)}%)` : label
                        const confCss = conf !== undefined ? Math.max(0.3, Math.min(1, conf)).toFixed(2) : undefined
                        return (
                          <span className="chip-wrap" style={{ marginLeft: 8 }}>
                            <span
                              className={`chip ${cls}`}
                              style={{ ...(confCss ? { ['--conf']: confCss } : {}) }}
                              data-conf={confCss ? '1' : undefined}
                              title={title}
                            >
                              {(label === 'positive' && '😊 正向') || (label === 'negative' && '☹️ 負向') || '😐 中立'}
                              {conf !== undefined && (
                                <span style={{ marginLeft: 4, fontSize: '11px', opacity: 0.9 }}>
                                  {(conf * 100).toFixed(0)}%
                                </span>
                              )}
                            </span>
                            {showKw && Array.isArray(s.topTokens) && s.topTokens.length > 0 && (
                              <div className="kw-popover">
                                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>關鍵詞</div>
                                <span className="kw-tags">
                                  {s.topTokens.slice(0, 8).map((t, i) => (
                                    <span key={i} className={`kw-tag ${t.label === 'neg' ? 'kw-neg' : (t.label === 'pos' ? 'kw-pos' : 'kw-neu')}`} title={`貢獻度 ${(t.contrib * 100).toFixed(1)}%`}>
                                      {t.text}
                                    </span>
                                  ))}
                                </span>
                              </div>
                            )}
                          </span>
                        )
                      })()}
                      
                    </>
                  )}
                </div>
                <div className="entry-actions">
                  <button className="btn btn-secondary" onClick={() => restore(e.id)}>還原</button>
                  <button className="btn btn-danger" onClick={() => hardDelete(e.id)}>永久刪除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p style={{ color: 'crimson', marginTop: '0.75rem' }}>{error}</p>
        )}
      </div>
    </div>
  )
}
