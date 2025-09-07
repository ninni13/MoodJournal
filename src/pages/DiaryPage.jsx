import { useCallback, useEffect, useMemo, useState } from 'react'
import CryptoJS from 'crypto-js'
import { addPending, getAllPending, deletePending } from '../lib/idb.js'
import { Link } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isAfter, subDays, subMonths } from 'date-fns'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ReferenceLine } from 'recharts'
import { useAuth } from '../state/AuthContext.jsx'
import { db, logout } from '../lib/firebase.js'
import { addDoc, collection, doc, getDocs, getDoc, orderBy, query, updateDoc, where, setDoc } from 'firebase/firestore'
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

// Mock sentiment analyzer — replace with real API later
function analyzeSentiment(text) {
  const s = String(text || '')

  // 關鍵詞字典（可再擴充）
  const positiveWords = ['開心', '快樂', '興奮', '幸福', '讚', '爽', '好吃', '好玩', '愛']
  const negativeWords = ['累', '難過', '生氣', '煩', '討厭', '壓力', '痛苦', '失望', '不喜歡']

  let posHits = 0
  let negHits = 0
  positiveWords.forEach(w => { if (s.includes(w)) posHits++ })
  negativeWords.forEach(w => { if (s.includes(w)) negHits++ })

  const raw = posHits - negHits
  let label = 'neutral'
  if (raw > 0) label = 'positive'
  else if (raw < 0) label = 'negative'

  // 分數規則：
  // - 正向：>= 0.7（起始 0.8）
  // - 中立：= 0.5
  // - 負向：<= 0.3（起始 0.2）
  let score
  if (label === 'positive') {
    score = Math.min(1, 0.8 + Math.max(0, posHits - 1) * 0.05)
  } else if (label === 'negative') {
    score = Math.max(0, 0.2 - Math.max(0, negHits - 1) * 0.05)
  } else {
    score = 0.5
  }

  return { label, score }
}


function sentimentView(sentiment) {
  const label = sentiment?.label || 'neutral'
  const map = {
    positive: { emoji: '😊', text: '正向', cls: 'chip-positive' },
    neutral: { emoji: '😐', text: '中立', cls: 'chip-neutral' },
    negative: { emoji: '☹️', text: '負向', cls: 'chip-negative' },
  }
  const m = map[label] || map.neutral
  return (
    <span className={`chip ${m.cls}`} title={label}>
      <span style={{ marginRight: 4 }}>{m.emoji}</span>{m.text}
    </span>
  )
}

function scoreLabel(score) {
  if (score == null) return { emoji: '–', text: '無資料', color: '#9ca3af' }
  if (score < 0.3) return { emoji: '☹️', text: '負向', color: '#ef4444' }
  if (score > 0.7) return { emoji: '😊', text: '正向', color: '#10b981' }
  return { emoji: '😐', text: '中立', color: '#6b7280' }
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Simple AES helpers (key uses current user's uid for now)
function encryptText(plain, key) {
  try {
    return CryptoJS.AES.encrypt(String(plain), String(key)).toString()
  } catch {
    return null
  }
}
function decryptText(cipher, key) {
  try {
    const bytes = CryptoJS.AES.decrypt(String(cipher), String(key))
    const txt = bytes.toString(CryptoJS.enc.Utf8)
    return txt || null
  } catch {
    return null
  }
}

export default function DiaryPage() {
  const { currentUser } = useAuth()
  const [content, setContent] = useState('')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false)
  const [syncStatus, setSyncStatus] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  // Search & date filters
  const [searchQuery, setSearchQuery] = useState('')
  const today = new Date()
  // 預設改為「全部」，避免舊資料被本月篩掉
  const [quickPreset, setQuickPreset] = useState('all') // 'all' | 'thisMonth' | 'lastMonth' | 'custom'
  const [startDate, setStartDate] = useState(null)
  const [endDate, setEndDate] = useState(null)
  // Reminder settings
  // Settings moved to SettingsPage
  const [tab, setTab] = useState('line') // 'line' | 'heat'
  const [range, setRange] = useState('week') // 'week' | 'month'
  const [selectedDay, setSelectedDay] = useState(null) // 'YYYY-MM-DD'

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
      const patchList = []
      const normalizedNew = diaries.map(e => {
        // 先取得可用明文，再根據明文分析情緒
        let plain = null
        if (e.contentEnc) {
          plain = currentUser ? decryptText(e.contentEnc, currentUser.uid) : null
        }
        if (!plain && typeof e.content === 'string') {
          plain = String(e.content)
        }
        const computed = analyzeSentiment(plain)
        let sentiment = e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : computed
        // 若舊資料分數與新規則出入很大，則以新規則覆蓋並排入修補
        if (e.sentiment && typeof e.sentiment === 'object') {
          const diff = Math.abs(Number(e.sentiment.score ?? 0.5) - computed.score)
          if (e.sentiment.label !== computed.label || diff > 0.25) {
            sentiment = computed
            patchList.push({ id: e.id, sentiment })
          }
        }
        return {
          id: e.id,
          date: normalizeDate(e.date || todayKey()),
          content: String(plain ?? ''),
          isDeleted: Boolean(e.isDeleted),
          sentiment,
        }
      })

      const newIds = new Set(normalizedNew.map(e => e.id))
      const toMigrate = []
      const candidates = [...oldOnes, ...wrongUidOnes]
      for (const e of candidates) {
        const norm = {
          id: e.id,
          date: normalizeDate(e.date || todayKey()),
          content: String(e.content ?? ''),
          isDeleted: Boolean(e.isDeleted),
          updatedAt: e.updatedAt || new Date().toISOString(),
          sentiment: e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : analyzeSentiment(e.content),
        }
        if (!newIds.has(norm.id)) {
          try {
            // Write into new collection
            const contentEnc = currentUser ? encryptText(norm.content, currentUser.uid) : null
            const { content, ...rest } = norm
            await setDoc(doc(baseCol, norm.id), { ...rest, contentEnc })
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

      // 背景修補：把不一致的 sentiment 分數寫回 Firestore
      if (patchList.length) {
        try {
          for (const p of patchList) {
            await updateDoc(doc(baseCol, p.id), { sentiment: p.sentiment, updatedAt: new Date().toISOString() })
          }
        } catch (err) {
          console.warn('[sentiment-patch] failed:', err?.code || err?.message)
        }
      }
    } catch (e) {
      console.error(e)
      setError(e?.message || '讀取資料失敗')
    } finally {
      setLoading(false)
    }
  }, [baseCol, currentUser])

  useEffect(() => { refresh() }, [refresh])

  // 當離線時，把尚未同步的本機筆記也展示於列表（加上待同步標記）
  useEffect(() => {
    async function loadPendingIntoList() {
      if (!isOffline || !currentUser) return
      try {
        const pending = await getAllPending()
        if (!pending?.length) return
        setEntries(prev => {
          const add = pending.map(p => ({
            id: p.id,
            date: p.date,
            content: p.content,
            isDeleted: false,
            sentiment: p.sentiment,
            localPending: true,
          }))
          const ids = new Set(add.map(x => x.id))
          const rest = prev.filter(x => !ids.has(x.id))
          return [...add, ...rest]
        })
      } catch {}
    }
    loadPendingIntoList()
  }, [isOffline, currentUser])

  // Online/offline detection and sync
  useEffect(() => {
    function handleOffline() { setIsOffline(true) }
    async function handleOnline() {
      setIsOffline(false)
      // 若尚未完成登入（currentUser 可能還沒就緒），晚點重試
      if (!currentUser) {
        setSyncStatus('等待登入後同步…')
        setTimeout(() => { if (navigator.onLine) handleOnline() }, 1500)
        return
      }
      setSyncStatus('同步中…')
      try {
        const pending = await getAllPending()
        setPendingCount(pending.length)
        let ok = 0, fail = 0
        for (const e of pending) {
          try {
            const ref = doc(db, 'users', currentUser.uid, 'diaries', e.id)
            const exists = await getDoc(ref)
            if (!exists.exists()) {
              const contentEnc = encryptText(e.content, currentUser.uid)
              await setDoc(ref, { id: e.id, date: e.date, contentEnc, sentiment: e.sentiment, isDeleted: false, updatedAt: new Date().toISOString() })
            }
            await deletePending(e.id)
            ok++
          } catch (entryErr) {
            // 單筆失敗時保留在 pending，下次再試
            console.warn('[sync] fail one entry', e.id, entryErr?.message)
            fail++
          }
        }
        if (fail > 0) {
          setSyncStatus(`部分完成（成功 ${ok} / 失敗 ${fail}，稍後自動重試）`)
        } else {
          setSyncStatus('同步完成')
        }
        setTimeout(() => setSyncStatus(''), 2000)
        refresh()
      } catch (err) {
        console.error('[sync] 同步失敗', err)
        setSyncStatus('同步失敗，稍後自動重試')
        // 5 秒後自動再嘗試一次（若仍離線或網路不穩）
        setTimeout(() => {
          if (navigator.onLine) {
            handleOnline()
          }
        }, 5000)
        setTimeout(() => setSyncStatus(''), 4000)
      }
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [currentUser, db, refresh])

  // Settings moved to SettingsPage

  const canSave = useMemo(() => content.trim().length > 0, [content])

  async function handleSave() {
    const text = content.trim()
    if (!text || !baseCol) return
    try {
      const id = uuid()
      const newData = {
        id,
        date: todayKey(),
        isDeleted: false,
        updatedAt: new Date().toISOString(),
        sentiment: analyzeSentiment(text),
      }
      if (isOffline) {
        // Save to IndexedDB and reflect in UI
        await addPending({ ...newData, content: text, isSynced: false })
        setEntries(prev => [{ id, ...newData, content: text, localPending: true }, ...prev])
      } else {
        const contentEnc = currentUser ? encryptText(text, currentUser.uid) : null
        const ref = doc(baseCol, id)
        await setDoc(ref, { ...newData, contentEnc })
        setEntries(prev => [{ id, ...newData, content: text }, ...prev])
      }
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

  // Settings moved to SettingsPage

  // ===== Filters =====
  function applyPreset(preset) {
    setQuickPreset(preset)
    const now = new Date()
    if (preset === 'all') {
      setStartDate(null)
      setEndDate(null)
    } else if (preset === 'thisMonth') {
      setStartDate(startOfMonth(now))
      setEndDate(endOfMonth(now))
    } else if (preset === 'lastMonth') {
      const lm = subMonths(now, 1)
      setStartDate(startOfMonth(lm))
      setEndDate(endOfMonth(lm))
    } else {
      // custom: keep current start/end
    }
  }

  const filteredDiaries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const s = startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()) : null
    const e = endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) : null
    return entries.filter(it => {
      const d = parseISO(it.date)
      if (s && d < s) return false
      if (e && d > e) return false
      if (!q) return true
      return String(it.content).toLowerCase().includes(q)
    })
  }, [entries, searchQuery, startDate, endDate])

  const sortedFiltered = useMemo(() =>
    [...filteredDiaries].sort((a,b) => toEpoch(b.date) - toEpoch(a.date)),
  [filteredDiaries])

  function filterTitle() {
    const hasCustomRange = startDate && endDate && (startDate.getFullYear() !== endDate.getFullYear() || startDate.getMonth() !== endDate.getMonth())
    let base
    if (!startDate && !endDate) base = '全部歷史紀錄'
    else if (hasCustomRange) base = `${format(startDate, 'yyyy/MM/dd')} - ${format(endDate, 'yyyy/MM/dd')} 歷史紀錄`
    else base = `${format((endDate || new Date()), 'yyyy/MM')} 歷史紀錄`
    const q = searchQuery.trim()
    return q ? `${base}（含『${q}』）` : base
  }

  const hasActiveFilter = useMemo(() => {
    return searchQuery.trim() !== '' || quickPreset !== 'all'
  }, [searchQuery, quickPreset])

  // ===== Insights data derived from entries =====
  const lineData = useMemo(() => {
    const now = new Date()
    const days = range === 'week' ? 7 : 30

    // Anchor the range to the latest diary date to ensure newly edited future dates show up
    let latest = new Date(0)
    for (const it of sortedFiltered) {
      const d = parseISO(it.date)
      if (d > latest) latest = d
    }
    const end = latest > now ? latest : now
    const start = subDays(end, days - 1)
    const allDays = eachDayOfInterval({ start, end })

    const byKey = new Map()
    for (const it of sortedFiltered) {
      const d = parseISO(it.date)
      if (isAfter(start, d)) continue // skip before range
      if (d > end) continue // skip after range
      const k = it.date
      if (!byKey.has(k)) byKey.set(k, [])
      const val = Number(it?.sentiment?.score ?? 0.5)
      byKey.get(k).push(val)
    }

    return allDays.map(d => {
      const k = format(d, 'yyyy-MM-dd')
      const arr = byKey.get(k) || []
      const avg = arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null
      return { date: k, score: avg }
    })
  }, [entries, range])

  const monthHeat = useMemo(() => {
    // Heatmap follows the month of endDate if provided, else current month
    const base = endDate || new Date()
    const start = startOfMonth(base)
    const end = endOfMonth(base)
    const days = eachDayOfInterval({ start, end })
    const byKey = new Map()
    for (const it of sortedFiltered) {
      const k = it.date
      const dt = parseISO(k)
      if (dt < start || dt > end) continue
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(Number(it?.sentiment?.score ?? 0.5))
    }
    return days.map(d => {
      const k = format(d, 'yyyy-MM-dd')
      const arr = byKey.get(k) || []
      const avg = arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null
      return { date: k, score: avg, day: d.getDate(), dow: d.getDay() }
    })
  }, [entries])

  const selectedDayItems = useMemo(() => {
    if (!selectedDay) return []
    return sortedFiltered.filter(i => i.date === selectedDay)
  }, [sortedFiltered, selectedDay])

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
      const sentiment = analyzeSentiment(text)
      const contentEnc = encryptText(text, currentUser.uid)
      await updateDoc(doc(baseCol, id), {
        contentEnc,
        updatedAt: new Date().toISOString(),
        sentiment,
      })
      setEntries(prev => prev.map(e => (e.id === id ? { ...e, content: text, sentiment } : e)))
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
          <Link to="/settings" style={{ marginRight: '0.75rem', fontSize: 14 }}>設定</Link>
          <Link to="/trash" style={{ marginRight: '0.75rem', fontSize: 14 }}>垃圾桶</Link>
          <span style={{ marginRight: '0.75rem', color: '#666', fontSize: 14 }}>{currentUser?.displayName}</span>
          <button className="btn btn-outline" onClick={logout}>登出</button>
        </div>
      </div>

      {isOffline && (
        <div className="toast toast-error" style={{ position: 'static', marginTop: 8 }}>
          目前為離線模式，筆記會先儲存在本機並於恢復網路後自動同步。
        </div>
      )}
      {!!syncStatus && !isOffline && (
        <div className="toast toast-success" style={{ position: 'static', marginTop: 8 }}>
          {syncStatus}
        </div>
      )}

      {/* Filters */}
      <div className="filters">
        <div className="filters-row">
          <div className="filter-actions">
            <button className={`btn ${quickPreset === 'all' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('all')}>全部</button>
            <button className={`btn ${quickPreset === 'thisMonth' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('thisMonth')}>本月</button>
            <button className={`btn ${quickPreset === 'lastMonth' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('lastMonth')}>上月</button>
            <button className={`btn ${quickPreset === 'custom' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('custom')}>自訂</button>

            {quickPreset === 'custom' && (
              <>
                <input
                  className="input"
                  style={{ maxWidth: 170 }}
                  type="date"
                  value={startDate ? format(startDate, 'yyyy-MM-dd') : ''}
                  onChange={(e) => setStartDate(e.target.value ? parseISO(e.target.value) : null)}
                />
                <span style={{ color: '#888' }}>到</span>
                <input
                  className="input"
                  style={{ maxWidth: 170 }}
                  type="date"
                  value={endDate ? format(endDate, 'yyyy-MM-dd') : ''}
                  onChange={(e) => setEndDate(e.target.value ? parseISO(e.target.value) : null)}
                />
              </>
            )}
          </div>

          <input
            className="input search-inline"
            type="text"
            placeholder="搜尋內文，例如：考試、旅行、emo"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Reminder settings moved to /settings */}

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
        <h2 className="subtitle">{hasActiveFilter ? `${filterTitle()}（篩選後共 ${sortedFiltered.length} 篇）` : '所有日記'}</h2>
        {loading ? (
          <p className="empty">載入中…</p>
        ) : sortedFiltered.length === 0 ? (
          <p className="empty">尚無日記，寫下第一筆吧！</p>
        ) : (
          <ul className="entries">
            {sortedFiltered.map((e) => (
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
                    <>
                      <span className="entry-summary">{summary(e.content)}</span>
                      {sentimentView(e.sentiment)}
                      {e.localPending && (
                        <span className="chip chip-pending" title="尚未同步">待同步</span>
                      )}
                    </>
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
      
      {/* Insights Section */}
      <div className="list" style={{ marginTop: '1.5rem' }}>
        <h2 className="subtitle">情緒視覺化</h2>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className={`btn ${tab === 'line' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('line')}>折線圖</button>
          <button className={`btn ${tab === 'heat' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('heat')}>熱力圖</button>
        </div>

        {tab === 'line' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className={`btn ${range === 'week' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => setRange('week')}>最近 7 天</button>
              <button className={`btn ${range === 'month' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => setRange('month')}>最近 30 天</button>
            </div>
            {loading ? (
              <p className="empty">載入中…</p>
            ) : (
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={lineData} margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) => format(parseISO(v), 'MM/dd')}
                      minTickGap={20}
                      tickMargin={12}
                    />
                    <YAxis domain={[0, 1]} tickCount={6} />
                    {/* Sentiment bands */}
                    <ReferenceArea y1={0} y2={0.3} fill="#fee2e2" fillOpacity={0.6} strokeOpacity={0} />
                    <ReferenceArea y1={0.3} y2={0.7} fill="#f3f4f6" fillOpacity={0.6} strokeOpacity={0} />
                    <ReferenceArea y1={0.7} y2={1} fill="#dcfce7" fillOpacity={0.6} strokeOpacity={0} />
                    <ReferenceLine y={0.3} stroke="#d1d5db" strokeDasharray="3 3" />
                    <ReferenceLine y={0.7} stroke="#d1d5db" strokeDasharray="3 3" />
                    <Tooltip
                      labelFormatter={(v) => format(parseISO(v), 'yyyy/MM/dd')}
                      formatter={(val) => {
                        const s = Number(val)
                        const m = scoreLabel(s)
                        return [`${s?.toFixed?.(2)} ${m.emoji} ${m.text}`, '情緒']
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#d36f72"
                      strokeWidth={2}
                      connectNulls
                      dot={(p) => {
                        const { cx, cy, value } = p
                        if (value == null || Number.isNaN(value) || !isFinite(value)) return null
                        if (!isFinite(cx) || !isFinite(cy)) return null
                        const m = scoreLabel(value)
                        return <circle cx={cx} cy={cy} r={3} fill={m.color} stroke="#fff" strokeWidth={1} />
                      }}
                      activeDot={(p) => {
                        const { cx, cy, value } = p
                        if (value == null || Number.isNaN(value) || !isFinite(value)) return null
                        if (!isFinite(cx) || !isFinite(cy)) return null
                        return <circle cx={cx} cy={cy} r={5} fill="#d36f72" stroke="#fff" strokeWidth={1} />
                      }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {tab === 'heat' && (
          <div style={{ marginTop: 12 }}>
            {loading ? (
              <p className="empty">載入中…</p>
            ) : (
              <>
                <div className="heatmap">
                  <div className="heatmap-grid">
                    {['日','一','二','三','四','五','六'].map((d) => (
                      <div key={`h-${d}`} className="heatmap-header">{d}</div>
                    ))}
                    {monthHeat.map((d, idx) => {
                      const score = d.score
                      let cls = 'neutral'
                      const today = new Date(); today.setHours(0,0,0,0)
                      const isFuture = parseISO(d.date) > today
                      if (isFuture) {
                        cls = 'future'
                      } else if (score != null) {
                        if (score < 0.3) cls = 'neg'
                        else if (score > 0.7) cls = 'pos'
                        else cls = 'neutral'
                      }
                      const style = { gridColumnStart: idx === 0 ? (d.dow + 1) : 'auto' }
                      return (
                        <button
                          key={d.date}
                          className={`heat-cell ${cls}`}
                          style={style}
                          title={isFuture ? `${d.date} - 未來` : `${d.date}${score != null ? ` - 平均 ${score.toFixed(2)}` : ''}`}
                          onClick={() => !isFuture && setSelectedDay(d.date)}
                          disabled={isFuture}
                        >
                          <span className="heat-day">{d.day}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="heat-legend">
                    <span className="legend neg">負向</span>
                    <span className="legend neutral">中立</span>
                    <span className="legend pos">正向</span>
                  </div>
                </div>

                {selectedDay && (
                  <div style={{ marginTop: 12 }}>
                    <h2 className="subtitle">{format(parseISO(selectedDay), 'yyyy/MM/dd')} 的日記</h2>
                    {selectedDayItems.length === 0 ? (
                      <p className="empty">當日沒有日記</p>
                    ) : (
                      <ul className="entries">
                        {selectedDayItems.map(e => (
                          <li key={e.id} className="entry">
                            <div className="entry-main">
                              <span className="entry-full">{e.content}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
// Normalize incoming date to ISO yyyy-MM-dd
function normalizeDate(input) {
  try {
    // Firestore Timestamp
    if (input && typeof input === 'object') {
      if (typeof input.toDate === 'function') {
        const d = input.toDate()
        return format(d, 'yyyy-MM-dd')
      }
      // Date instance
      if (input instanceof Date && !isNaN(input)) {
        return format(input, 'yyyy-MM-dd')
      }
    }
    // String forms
    const s = String(input || '').trim()
    if (!s) return todayKey()
    // Replace common separators with '-'
    const parts = s.replace(/[^0-9]+/g, '-').split('-').filter(Boolean)
    const now = new Date()
    let y, m, d
    if (parts.length === 3) {
      // Could be yyyy-mm-dd or mm-dd-yy
      if (parts[0].length === 4) {
        y = Number(parts[0])
        m = Number(parts[1])
        d = Number(parts[2])
      } else {
        // Assume mm-dd-(yy)yy with current century fallback
        y = Number(parts[2])
        if (y < 100) y = 2000 + y
        m = Number(parts[0])
        d = Number(parts[1])
      }
    } else if (parts.length === 2) {
      // mm-dd with current year
      y = now.getFullYear()
      m = Number(parts[0])
      d = Number(parts[1])
    } else if (parts.length === 1 && parts[0].length >= 8) {
      // Probably compact yyyymmdd
      const str = parts[0]
      y = Number(str.slice(0, 4))
      m = Number(str.slice(4, 6))
      d = Number(str.slice(6, 8))
    } else {
      return todayKey()
    }
    if (!y || !m || !d) return todayKey()
    const mm = String(Math.max(1, Math.min(12, m))).padStart(2, '0')
    const dd = String(Math.max(1, Math.min(31, d))).padStart(2, '0')
    return `${y}-${mm}-${dd}`
  } catch {
    return todayKey()
  }
}
