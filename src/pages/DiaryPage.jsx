import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'
import { db, logout } from '../lib/firebase.js'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
  setDoc,
} from 'firebase/firestore'
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

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export default function DiaryPage() {
  const { currentUser } = useAuth()
  const [content, setContent] = useState('')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')

  const baseCol = useMemo(() => {
    if (!currentUser) return null
    return collection(db, 'users', currentUser.uid, 'diaries')
  }, [currentUser])

  const refresh = useCallback(async () => {
    if (!baseCol) return
    setLoading(true)
    setError('')
    try {
      // Avoid composite index for now: order only, filter client-side
      const q1 = query(baseCol, orderBy('date', 'desc'))
      const snap1 = await getDocs(q1)
      const diaries = snap1.docs.map(d => ({ id: d.id, ...d.data() }))

      // Backward compatibility: also check old collection name `diary`
      let oldOnes = []
      try {
        const oldCol = collection(db, 'users', currentUser.uid, 'diary')
        const q2 = query(oldCol, orderBy('date', 'desc'))
        const snap2 = await getDocs(q2)
        oldOnes = snap2.docs.map(d => ({ id: d.id, ...d.data(), __legacy: true }))
      } catch (err) {
        // Likely due to Firestore rules not allowing the legacy path; skip silently
        console.warn('[migrate] skip legacy read due to permission:', err?.code || err?.message)
      }

      // Handle mistakenly stored docs at users/uid/diaries/* (literal "uid")
      let wrongUidOnes = []
      try {
        const wrongUidCol = collection(db, 'users', 'uid', 'diaries')
        const q3 = query(wrongUidCol, orderBy('date', 'desc'))
        const snap3 = await getDocs(q3)
        wrongUidOnes = snap3.docs.map(d => ({ id: d.id, ...d.data(), __wrongUid: true }))
      } catch (err) {
        console.warn('[migrate] skip users/uid/diaries due to permission:', err?.code || err?.message)
      }

      // Normalize and migrate legacy docs to new collection if missing
      const normalizedNew = diaries.map(e => ({
        id: e.id,
        date: String(e.date || todayKey()).slice(0, 10).replaceAll('/', '-'),
        content: String(e.content ?? ''),
        isDeleted: Boolean(e.isDeleted),
      }))

      const newIds = new Set(normalizedNew.map(e => e.id))
      const toMigrate = []
      const candidates = [...oldOnes, ...wrongUidOnes]
      for (const e of candidates) {
        const norm = {
          id: e.id,
          date: String(e.date || todayKey()).slice(0, 10).replaceAll('/', '-'),
          content: String(e.content ?? ''),
          isDeleted: Boolean(e.isDeleted),
          updatedAt: e.updatedAt || new Date().toISOString(),
        }
        if (!newIds.has(norm.id)) {
          try {
            // Write into new collection
            await setDoc(doc(baseCol, norm.id), { ...norm })
            toMigrate.push(norm)
          } catch (err) {
            console.warn('[migrate] failed to write migrated doc:', err?.code || err?.message)
          }
        }
      }

      const merged = [...normalizedNew, ...toMigrate]
        .filter(e => e.isDeleted !== true)
        .sort((a, b) => toEpoch(b.date) - toEpoch(a.date))

      setEntries(merged)
    } catch (e) {
      console.error(e)
      setError(e?.message || '讀取資料失敗')
    } finally {
      setLoading(false)
    }
  }, [baseCol, currentUser])

  useEffect(() => { refresh() }, [refresh])

  const canSave = useMemo(() => content.trim().length > 0, [content])

  async function handleSave() {
    const text = content.trim()
    if (!text || !baseCol) return
    try {
      const id = uuid()
      const newData = {
        id,
        date: todayKey(),
        content: text,
        isDeleted: false,
        updatedAt: new Date().toISOString(),
      }
      const ref = doc(baseCol, id)
      await setDoc(ref, newData)
      setEntries(prev => [{ id, ...newData }, ...prev])
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

  async function startEdit(id, current) {
    setEditingId(id)
    setEditingText(current)
  }

  async function saveEdit(id) {
    if (!id || !currentUser || !baseCol) return
    const text = String(editingText).trim()
    if (!text) return
    try {
      await updateDoc(doc(baseCol, id), {
        content: text,
        updatedAt: new Date().toISOString(),
      })
      setEntries(prev => prev.map(e => (e.id === id ? { ...e, content: text } : e)))
      setEditingId(null)
      setEditingText('')
    } catch (e) {
      console.error(e)
      setError(e?.message || '更新失敗')
    }
  }

  async function softDelete(id) {
    if (!id || !currentUser || !baseCol) return
    const ok = window.confirm('確定要刪除這篇日記嗎？（可於垃圾桶還原）')
    if (!ok) return
    try {
      await updateDoc(doc(baseCol, id), { isDeleted: true, updatedAt: new Date().toISOString() })
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch (e) {
      console.error(e)
      setError(e?.message || '刪除失敗')
    }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="title" style={{ marginBottom: 0 }}>霓的情緒日記</h1>
        <div>
          <Link to="/trash" style={{ marginRight: '0.75rem', fontSize: 14 }}>垃圾桶</Link>
          <span style={{ marginRight: '0.75rem', color: '#666', fontSize: 14 }}>{currentUser?.displayName}</span>
          <button className="btn btn-outline" onClick={logout}>登出</button>
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
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave}>
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
                  {editingId === e.id ? (
                    <textarea
                      className="textarea"
                      value={editingText}
                      onChange={(ev) => setEditingText(ev.target.value)}
                      rows={4}
                    />
                  ) : (
                    <span className="entry-summary">{summary(e.content)}</span>
                  )}
                </div>
                {editingId === e.id ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" onClick={() => saveEdit(e.id)}>儲存</button>
                    <button className="btn btn-secondary" onClick={() => { setEditingId(null); setEditingText('') }}>取消</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-outline" onClick={() => startEdit(e.id, e.content)}>編輯</button>
                    <button className="btn btn-danger" onClick={() => softDelete(e.id)}>刪除</button>
                  </div>
                )}
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
