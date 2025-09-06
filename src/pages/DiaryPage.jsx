import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../state/AuthContext.jsx'
import { db, logout } from '../lib/firebase.js'
import { addDoc, collection, getDocs } from 'firebase/firestore'
import '../App.css'

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

export default function DiaryPage() {
  const { currentUser } = useAuth()
  const [content, setContent] = useState('')
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
      const snap = await getDocs(baseCol)
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Normalize
      const normalized = list.map(e => ({
        id: e.id,
        date: String(e.date || todayKey()).slice(0, 10).replaceAll('/', '-'),
        content: String(e.content ?? ''),
      }))
      // Sort by date desc
      normalized.sort((a, b) => toEpoch(b.date) - toEpoch(a.date))
      setEntries(normalized)
    } catch (e) {
      console.error(e)
      setError(e?.message || '讀取資料失敗')
    } finally {
      setLoading(false)
    }
  }, [baseCol])

  useEffect(() => { refresh() }, [refresh])

  const canSave = useMemo(() => content.trim().length > 0, [content])

  async function handleSave() {
    const text = content.trim()
    if (!text || !baseCol) return
    try {
      const newData = { date: todayKey(), content: text }
      const ref = await addDoc(baseCol, newData)
      setEntries(prev => [{ id: ref.id, ...newData }, ...prev])
      setContent('')
    } catch (e) {
      console.error(e)
      setError(e?.message || '存檔失敗')
    }
  }

  function summary(text, max = 30) {
    const s = String(text).replace(/\s+/g, ' ').trim()
    if (s.length <= max) return s
    return s.slice(0, max) + '…'
  }

  // 刪除功能暫時移除（Day 13 會補上）

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="title" style={{ marginBottom: 0 }}>情緒日記</h1>
        <div>
          <span style={{ marginRight: '0.75rem', color: '#666', fontSize: 14 }}>{currentUser?.displayName}</span>
          <button className="save" onClick={logout}>登出</button>
        </div>
      </div>

      <div className="editor">
        <label htmlFor="content" className="label">日記內容</label>
        <textarea
          id="content"
          className="textarea"
          placeholder="輸入今天的心情..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
        />
        <div className="actions">
          <button className="save" onClick={handleSave} disabled={!canSave}>
            存檔
          </button>
        </div>
      </div>

      <div className="list">
        <h2 className="subtitle">所有日記</h2>
        {loading ? (
          <p className="empty">載入中…</p>
        ) : entries.length === 0 ? (
          <p className="empty">尚無日記，寫下第一筆吧！</p>
        ) : (
          <ul className="entries">
            {entries.map((e) => (
              <li key={e.id} className="entry">
                <div className="entry-main">
                  <span className="entry-date">{formatDisplayDate(e.date)}</span>
                  <span className="entry-sep">|</span>
                  <span className="entry-summary">{summary(e.content)}</span>
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
