import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CryptoJS from 'crypto-js'
import { addPending, getAllPending, deletePending } from '../lib/idb.js'
import { Link } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isAfter, subDays, subMonths } from 'date-fns'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ReferenceLine } from 'recharts'
import { useAuth } from '../state/AuthContext.jsx'
import { db, logout } from '../lib/firebase.js'
import { inferSentiment } from '../lib/sentiment'
import { inferSpeechEmotion } from '../lib/speech'
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

// 簡易本地情緒分析（可替換為真實 API）
function analyzeSentiment(text) {
  const s = String(text || '')

  // 關鍵詞字典（可再擴充）
  const positiveWords = ['開心', '快樂', '愉悅', '幸福', '讚', '爽', '好吃', '好玩', '愛']
  const negativeWords = ['累', '難過', '生氣', '煩', '壓力', '痛苦', '失望', '不喜歡']

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
  const confidence = typeof sentiment?.confidence === 'number' ? sentiment.confidence : undefined
  const topTokens = Array.isArray(sentiment?.topTokens) ? sentiment.topTokens : []
  const map = {
    positive: { emoji: '😊', text: '正向', cls: 'chip-positive' },
    neutral:  { emoji: '😐', text: '中立', cls: 'chip-neutral' },
    negative: { emoji: '☹️', text: '負向', cls: 'chip-negative' },
  }
  const m = map[label] || map.neutral

  // 標題包含信心
  let title = label
  if (confidence !== undefined) title += ` (信心: ${(confidence * 100).toFixed(1)}%)`

  // 信心對應飽和度（0.3~1.0），避免過淡
  const confForCss = confidence !== undefined ? Math.max(0.3, Math.min(1, confidence)).toFixed(2) : undefined

  const showKw = label === 'positive' || label === 'negative'

  return (
    <span className="chip-wrap">
      <span
        className={`chip ${m.cls}`}
        title={title}
        data-conf={confForCss ? '1' : undefined}
        style={confForCss ? { ['--conf']: confForCss } : undefined}
      >
        <span style={{ marginRight: 4 }}>{m.emoji}</span>
        {m.text}
        {confidence !== undefined && (
          <span style={{ marginLeft: 4, fontSize: '11px', opacity: 0.9 }}>
            {(confidence * 100).toFixed(0)}%
          </span>
        )}
      </span>

      {showKw && topTokens.length > 0 && (
        <div className="kw-popover">
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>關鍵詞</div>
          <span className="kw-tags">
            {topTokens.slice(0, 8).map((t, i) => {
              const tagCls = t.label === 'neg' ? 'kw-neg' : (t.label === 'pos' ? 'kw-pos' : 'kw-neu')
              const pct = typeof t.contrib === 'number' ? (t.contrib * 100).toFixed(1) : '–'
              return (
                <span key={i} className={`kw-tag ${tagCls}`} title={`貢獻度 ${pct}%`}>
                  {t.text}
                </span>
              )
            })}
          </span>
        </div>
      )}
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

// 簡易 AES：以目前使用者 uid 當 key（僅示範；正式環境建議另行管理）
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

// 走遠端 API；回傳 { label, score, confidence, topTokens }
async function analyzeSentimentViaApi(text) {
  try {
    const r = await inferSentiment(text)
    if (!r.ok) {
      throw new Error('API response not ok')
    }
    const labelMap = { pos: 'positive', neu: 'neutral', neg: 'negative' }
    const mappedLabel = labelMap[r.label] || 'neutral'

    let score = 0.5
    if (r.probs && typeof r.probs === 'object') {
      const { neg, neu, pos } = r.probs
      // 以機率轉換為 0-1 分數：負向=0、中立=0.5、正向=1
      score = pos + (neu * 0.5)
    }

    return {
      label: mappedLabel,
      score,
      confidence: r.confidence,
      topTokens: r.top_tokens || [],
      model: r.model,
      version: r.version
    }
  } catch (e) {
    console.warn('API sentiment analysis failed, falling back to local:', e)
    return analyzeSentiment(text)
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
  // 搜尋與日期篩選
  const [searchQuery, setSearchQuery] = useState('')
  const today = new Date()
  // 預設為「全部」，避免本月以外資料被隱藏
  const [quickPreset, setQuickPreset] = useState('all') // 'all' | 'thisMonth' | 'lastMonth' | 'custom'
  const [startDate, setStartDate] = useState(null)
  const [endDate, setEndDate] = useState(null)
  // 圖表
  const [tab, setTab] = useState('line')   // 'line' | 'heat'
  const [range, setRange] = useState('week') // 'week' | 'month'
  const [selectedDay, setSelectedDay] = useState(null) // 'YYYY-MM-DD'
  // 語音情緒
  const [speechEmotion, setSpeechEmotion] = useState(null)
  const [speechBusy, setSpeechBusy] = useState(false)
  const [speechResetKey, setSpeechResetKey] = useState(0)

  const baseCol = useMemo(() => {
    if (!currentUser) return null
    return collection(db, 'users', currentUser.uid, 'diaries')
  }, [currentUser])

  const refresh = useCallback(async () => {
    if (!baseCol) return
    setLoading(true)
    setError('')
    try {
      // 以日期排序；篩選在客端做
      const q1 = query(baseCol, orderBy('date', 'desc'))
      const snap1 = await getDocs(q1)
      const diaries = snap1.docs.map(d => ({ id: d.id, ...d.data() }))

      // 向後相容：讀舊的 collection `diary`
      let oldOnes = []
      try {
        const oldCol = collection(db, 'users', currentUser.uid, 'diary')
        const q2 = query(oldCol, orderBy('date', 'desc'))
        const snap2 = await getDocs(q2)
        oldOnes = snap2.docs.map(d => ({ id: d.id, ...d.data(), __legacy: true }))
      } catch (err) {
        console.warn('[migrate] skip legacy read due to permission:', err?.code || err?.message)
      }

      // 誤存 users/uid/diaries（字串 "uid"）的位置
      let wrongUidOnes = []
      try {
        const wrongUidCol = collection(db, 'users', 'uid', 'diaries')
        const q3 = query(wrongUidCol, orderBy('date', 'desc'))
        const snap3 = await getDocs(q3)
        wrongUidOnes = snap3.docs.map(d => ({ id: d.id, ...d.data(), __wrongUid: true }))
      } catch (err) {
        console.warn('[migrate] skip users/uid/diaries due to permission:', err?.code || err?.message)
      }

      // 正規化與修補 sentiment 欄位
      const patchList = []
      const normalizedNew = diaries.map(e => {
        // 先取可用明文，再依明文分析情緒
        let plain = null
        if (e.contentEnc) {
          plain = currentUser ? decryptText(e.contentEnc, currentUser.uid) : null
        }
        if (!plain && typeof e.content === 'string') {
          plain = String(e.content)
        }
        let sentiment = e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : analyzeSentiment(plain)
        if (!e.sentiment || typeof e.sentiment !== 'object') {
          patchList.push({ id: e.id, sentiment })
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
            // 寫入新的 collection
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
      setError(e?.message || '取得資料失敗')
    } finally {
      setLoading(false)
    }
  }, [baseCol, currentUser])

  useEffect(() => { refresh() }, [refresh])

  // 離線時顯示 IndexedDB 待同步資料
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

  // 線上/離線偵測與自動同步
  useEffect(() => {
    function handleOffline() { setIsOffline(true) }
    async function handleOnline() {
      setIsOffline(false)
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

  const canSave = useMemo(() => content.trim().length > 0 && !speechBusy, [content, speechBusy])

  async function handleSave() {
    const text = content.trim()
    if (!text || !baseCol) return
    try {
      const id = uuid()
      let s = speechEmotion
      if (!s) {
        s = await analyzeSentimentViaApi(text)
      }
      const newData = {
        id,
        date: todayKey(),
        isDeleted: false,
        updatedAt: new Date().toISOString(),
        sentiment: s,
      }
      if (isOffline) {
        // 先存 IndexedDB 並反映在 UI
        await addPending({ ...newData, content: text, isSynced: false })
        setEntries(prev => [{ id, ...newData, content: text, localPending: true }, ...prev])
      } else {
        const contentEnc = currentUser ? encryptText(text, currentUser.uid) : null
        const ref = doc(baseCol, id)
        await setDoc(ref, { ...newData, contentEnc })
        setEntries(prev => [{ id, ...newData, content: text }, ...prev])
      }
      setContent('')
      setSpeechEmotion(null)
      setSpeechResetKey(key => key + 1)
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

  // ===== 篩選器 =====
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
      // custom: 保持現有範圍
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
    return q ? `${base}（含「${q}」）` : base
  }

  const hasActiveFilter = useMemo(() => {
    return searchQuery.trim() !== '' || quickPreset !== 'all'
  }, [searchQuery, quickPreset])

  // ===== Insights: 折線圖資料 =====
  const lineData = useMemo(() => {
    const now = new Date()
    const days = range === 'week' ? 7 : 30

    // 以最新日記日期當尾端，確保未來日期（手動編輯）也能出現
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
      if (isAfter(start, d)) continue
      if (d > end) continue
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

  // ===== Insights: 月曆熱力圖資料 =====
  const monthHeat = useMemo(() => {
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

  async function startEdit(id, current) {
    setEditingId(id)
    setEditingText(current)
  }

  async function saveEdit(id) {
    if (!id || !currentUser || !baseCol) return
    const text = String(editingText).trim()
    if (!text) return
    try {
      const sentiment = await analyzeSentimentViaApi(text)
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
        <h1 className="title" style={{ marginBottom: 0 }}>我的情緒日記</h1>
        <div>
          <Link to="/settings" style={{ marginRight: '0.75rem', fontSize: 14 }}>設定</Link>
          <Link to="/trash" style={{ marginRight: '0.75rem', fontSize: 14 }}>垃圾桶</Link>
          <span style={{ marginRight: '0.75rem', color: '#666', fontSize: 14 }}>{currentUser?.displayName}</span>
          <button className="btn btn-outline" onClick={logout}>登出</button>
        </div>
      </div>

      {isOffline && (
        <div className="toast toast-error" style={{ position: 'static', marginTop: 8 }}>
          目前為離線模式，日記會先儲存在本機並於恢復網路後自動同步。
        </div>
      )}
      {!!syncStatus && !isOffline && (
        <div className="toast toast-success" style={{ position: 'static', marginTop: 8 }}>
          {syncStatus}
        </div>
      )}

      {/* 篩選列 */}
      <div className="filters">
        <div className="filters-row">
          <div className="filter-actions">
            <button className={`btn ${quickPreset === 'all' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('all')}>全部</button>
            <button className={`btn ${quickPreset === 'thisMonth' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('thisMonth')}>本月</button>
            <button className={`btn ${quickPreset === 'lastMonth' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('lastMonth')}>上月</button>
            <button className={`btn ${quickPreset === 'custom' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('custom')}>自訂</button>
          </div>

          <input
            className="input search-inline"
            type="text"
            placeholder="搜尋內文（例如：考試、旅行、emo）"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 自訂日期區間 */}
      {quickPreset === 'custom' && (
        <div className="filters-row" style={{ marginTop: 8 }}>
          <div className="filter-actions" style={{ gap: 8 }}>
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
          </div>
        </div>
      )}

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexGrow: 1, minWidth: 0 }}>
            <VoiceInput
              getContent={() => content}
              setContent={setContent}
              onSpeechEmotion={setSpeechEmotion}
              onSpeechBusy={setSpeechBusy}
              resetKey={speechResetKey}
            />
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave} style={{ marginLeft: 'auto' }}>儲存</button>
        </div>
      </div>

      <div className="list">
        <h2 className="subtitle">{hasActiveFilter ? `${filterTitle()}（篩選後共 ${sortedFiltered.length} 則）` : '所有日記'}</h2>
        {loading ? (
          <p className="empty">載入中…</p>
        ) : sortedFiltered.length === 0 ? (
          <p className="empty">尚無日記，寫下第一則吧！</p>
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
                  <div className="entry-actions">
                    <button className="btn btn-primary" onClick={() => saveEdit(e.id)}>儲存</button>
                    <button className="btn btn-secondary" onClick={() => { setEditingId(null); setEditingText('') }}>取消</button>
                  </div>
                ) : (
                  <div className="entry-actions">
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

      {/* Insights 區塊 */}
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
                    {/* 區帶：負/中/正 */}
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
                            <div className="entry-main" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
                              <div className="entry-full" style={{ whiteSpace: 'pre-wrap' }}>{e.content}</div>
                              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                {(() => {
                                  const s = e.sentiment || {}
                                  const label = s.label || 'neutral'
                                  const cls = label === 'positive' ? 'chip-positive' : (label === 'negative' ? 'chip-negative' : 'chip-neutral')
                                  const text = label === 'positive' ? '正向' : (label === 'negative' ? '負向' : '中立')
                                  return (
                                    <span className={`chip ${cls}`} style={{ padding: '0 10px', height: 22, lineHeight: '22px' }}>{text}</span>
                                  )
                                })()}
                                <span style={{ fontSize: 13, color: '#9ca3af' }}>｜ 關鍵字 top5：</span>
                                <span className="kw-tags" style={{ marginLeft: 0 }}>
                                  {(Array.isArray(e.sentiment?.topTokens) ? e.sentiment.topTokens.slice(0, 5) : []).map((t, i) => (
                                    <span key={i} className={`kw-tag ${t.label === 'neg' ? 'kw-neg' : (t.label === 'pos' ? 'kw-pos' : 'kw-neu')}`}>{t.text}</span>
                                  ))}
                                  {(!Array.isArray(e.sentiment?.topTokens) || e.sentiment.topTokens.length === 0) && (
                                    <span style={{ fontSize: 13, color: '#9ca3af' }}>—</span>
                                  )}
                                </span>
                              </div>
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

function VoiceInput({ getContent, setContent, onSpeechEmotion, onSpeechBusy, resetKey }) {
  const [recog, setRecog] = useState(null)
  const [listening, setListening] = useState(false)
  const [recording, setRecording] = useState(false)
  const [supported, setSupported] = useState(true)
  const [err, setErr] = useState('')
  const [interim, setInterim] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [audioMime, setAudioMime] = useState('')

  const baseRef = useRef('')
  const finalRef = useRef('')
  const lastAppendAtRef = useRef(0)
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const audioUrlRef = useRef('')

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) setSupported(false)
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop() } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
        audioUrlRef.current = ''
      }
    }
  }, [])

  useEffect(() => {
    if (resetKey == null) return
    clearAudio()
    onSpeechEmotion?.(null)
    chunksRef.current = []
    setErr('')
    setInterim('')
  }, [resetKey])

  function clearAudio() {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = ''
    }
    setAudioUrl('')
    setAudioMime('')
  }

  function mapSpeechEmotion(resp) {
    const probs = resp?.probs && typeof resp.probs === 'object' ? resp.probs : {}
    let label = resp?.pred || 'neutral'
    let score = typeof probs[label] === 'number' ? probs[label] : undefined
    const entries = Object.entries(probs)
    if (score == null && entries.length) {
      const [bestLabel, bestScore] = entries.reduce((acc, cur) => (cur[1] > acc[1] ? cur : acc))
      label = bestLabel
      score = bestScore
    }
    if (typeof score !== 'number') score = 0.5
    score = Math.max(0, Math.min(1, score))
    return {
      label,
      score,
      confidence: score,
      probs,
      source: 'speech'
    }
  }

  function stopRecorder() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop() } catch {}
    }
  }

  function attachHandlers(r) {
    r.onresult = (e) => {
      try {
        let interimText = ''
        let newFinal = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]
          if (res.isFinal) newFinal += res[0].transcript
          else interimText += res[0].transcript
        }
        const normalizeChunk = (s) => {
          if (!s) return ''
          let t = String(s)
          t = t
            .replace(/[，,]/g, '，')
            .replace(/[。\.]/g, '。')
            .replace(/[？\?]/g, '？')
            .replace(/([！!])+/g, '！')
            .replace(/[：:]/g, '：')
            .replace(/[；;]/g, '；')
            .replace(/[、]/g, '、')
            .replace(/\r?\n/g, '\n')
            .replace(/\s+/g, ' ')
          return t
        }
        newFinal = normalizeChunk(newFinal)
        interimText = normalizeChunk(interimText)

        if (newFinal) {
          const now = Date.now()
          const needComma = finalRef.current && !/[，。？！；：\n]$/.test(finalRef.current) && (now - (lastAppendAtRef.current || 0) >= 1200)
          if (needComma) finalRef.current += '，'
          lastAppendAtRef.current = now
        }

        if (newFinal) finalRef.current += newFinal
        const display = `${baseRef.current}${finalRef.current}${interimText}`
        setContent && setContent(display)
        setInterim(interimText)
      } catch {}
    }
    r.onerror = (e) => {
      const code = e?.error || ''
      if (code !== 'aborted' && code !== 'no-speech') setErr(code || 'speech error')
      stopRecorder()
      setListening(false)
      setInterim('')
    }
    r.onend = () => {
      stopRecorder()
      setListening(false)
      setContent && setContent(`${baseRef.current}${finalRef.current}`)
      setInterim('')
      setRecog(null)
    }
  }

  async function start() {
    setErr('')
    if (listening) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setSupported(false)
      setErr('瀏覽器不支援語音輸入')
      return
    }
    if (!(navigator?.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      setErr('瀏覽器不支援錄音')
      return
    }

    onSpeechEmotion?.(null)
    clearAudio()

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      console.error('[speech] getUserMedia failed', err)
      setErr(err?.message || '無法開始錄音')
      onSpeechBusy?.(false)
      return
    }

    try {
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) chunksRef.current.push(evt.data)
      }
      recorder.onstop = () => {
        mediaRecorderRef.current = null
        setRecording(false)
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }
        const mime = (recorder.mimeType && recorder.mimeType.startsWith('audio/')) ? recorder.mimeType : 'audio/webm;codecs=opus'
        const blob = new Blob(chunksRef.current, { type: mime })
        console.log('[speech] recorder stopped', { mimeType: recorder.mimeType, usedMime: mime, size: blob.size })
        chunksRef.current = []
        handleBlob(blob, mime)
      }
      mediaRecorderRef.current = recorder
      streamRef.current = stream
      try {
        recorder.start(500)
      } catch (err) {
        recorder.start()
      }
      setRecording(true)
      onSpeechBusy?.(true)
    } catch (err) {
      console.error('[speech] recorder start failed', err)
      setErr(err?.message || '無法開始錄音')
      if (stream) {
        stream.getTracks().forEach(track => track.stop())
      }
      onSpeechBusy?.(false)
      return
    }

    const r = new SR()
    r.lang = 'zh-TW'
    r.interimResults = true
    r.continuous = true
    attachHandlers(r)
    baseRef.current = getContent ? (getContent() || '') : ''
    if (baseRef.current && !(baseRef.current.endsWith('\n') || baseRef.current.endsWith(' '))) baseRef.current += ' '
    finalRef.current = ''
    setInterim('')
    lastAppendAtRef.current = Date.now()
    try {
      r.start()
      setRecog(r)
      setListening(true)
    } catch {}
  }

  function stop() {
    const r = recog
    if (r) {
      try { r.stop() } catch {}
      try { r.abort() } catch {}
    }
    stopRecorder()
    setListening(false)
    setInterim('')
  }

  async function handleBlob(blob, mimeUsed = 'audio/webm;codecs=opus') {
    try {
      clearAudio()
      if (!blob || !blob.size) {
        console.warn('[speech] empty blob, skip playback/inference')
        setErr('錄音內容為空，請再試一次')
        onSpeechBusy?.(false)
        return
      }
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      setAudioUrl(url)
      setAudioMime(mimeUsed || 'audio/webm;codecs=opus')
      const resp = await inferSpeechEmotion(blob)
      const mapped = mapSpeechEmotion(resp)
      onSpeechEmotion?.(mapped)
      setErr('')
    } catch (err) {
      console.error('[speech] infer failed', err)
      setErr(err?.message || '語音情緒辨識失敗')
      onSpeechEmotion?.(null)
    } finally {
      onSpeechBusy?.(false)
    }
  }

  if (!supported) {
    return <span style={{ fontSize: 12, color: '#9ca3af' }}>瀏覽器不支援語音輸入</span>
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className={`btn ${listening ? 'btn-danger' : 'btn-secondary'}`} onClick={listening ? stop : start}>
        {listening ? '停止語音輸入' : '開始語音輸入'}
      </button>
      {audioUrl && !listening && (
        <audio key={audioUrl} controls preload="auto" style={{ height: 32 }}>
          <source src={audioUrl} type={audioMime || 'audio/webm;codecs=opus'} />
          您的瀏覽器無法播放錄音檔案。
        </audio>
      )}
      {listening && <span style={{ fontSize: 12, color: '#9ca3af' }}>語音輸入中…</span>}
      {err && <span style={{ fontSize: 12, color: 'crimson' }}>{err}</span>}
    </div>
  )
}

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
    // 去非數字並以 '-' 連接
    const parts = s.replace(/[^0-9]+/g, '-').split('-').filter(Boolean)
    const now = new Date()
    let y, m, d
    if (parts.length === 3) {
      // yyyy-mm-dd 或 mm-dd-yy
      if (parts[0].length === 4) {
        y = Number(parts[0])
        m = Number(parts[1])
        d = Number(parts[2])
      } else {
        // 假設 mm-dd-(yy)yy；yy 用 2000 世紀補
        y = Number(parts[2])
        if (y < 100) y = 2000 + y
        m = Number(parts[0])
        d = Number(parts[1])
      }
    } else if (parts.length === 2) {
      // mm-dd，年用當年
      y = now.getFullYear()
      m = Number(parts[0])
      d = Number(parts[1])
    } else if (parts.length === 1 && parts[0].length >= 8) {
      // yyyymmdd
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




