import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'vibe.diary'

function safeParse(json) {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}` // ISO-like date only
}

function toEpoch(dateStr) {
  if (!dateStr) return 0
  const norm = String(dateStr).slice(0, 10).replaceAll('/', '-')
  const t = Date.parse(`${norm}T00:00:00`)
  return Number.isNaN(t) ? 0 : t
}

function formatDisplayDate(dateStr) {
  const norm = String(dateStr).replaceAll('-', '/')
  // Expect yyyy/MM/dd
  return norm
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Fallback simple uuid
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export default function App() {
  const [content, setContent] = useState('')
  const [entries, setEntries] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    const data = raw ? safeParse(raw) : null
    if (Array.isArray(data)) {
      return data
        .filter(e => e && typeof e === 'object')
        .map(e => ({
          id: e.id || uuid(),
          date: (e.date || todayKey()).slice(0, 10).replaceAll('/', '-'),
          content: String(e.content ?? ''),
        }))
    }
    return []
  })

  // Persist to localStorage when entries change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  }, [entries])

  const canSave = useMemo(() => content.trim().length > 0, [content])

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => toEpoch(b.date) - toEpoch(a.date))
  }, [entries])

  function handleSave() {
    const text = content.trim()
    if (!text) return
    const newEntry = {
      id: uuid(),
      date: todayKey(),
      content: text,
    }
    setEntries(prev => [newEntry, ...prev])
    setContent('')
  }

  function summary(text, max = 30) {
    const s = String(text).replace(/\s+/g, ' ').trim()
    if (s.length <= max) return s
    return s.slice(0, max) + '…'
  }

  return (
    <div className="container">
      <h1 className="title">情緒日記</h1>

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
        {sortedEntries.length === 0 ? (
          <p className="empty">尚無日記，寫下第一筆吧！</p>) : (
          <ul className="entries">
            {sortedEntries.map((e) => (
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
      </div>
    </div>
  )
}
