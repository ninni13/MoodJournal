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

// Mock sentiment analyzer â€” replace with real API later
function analyzeSentiment(text) {
  const s = String(text || '')

  // é—œéµè©žå­—å…¸ï¼ˆå¯å†æ“´å……ï¼‰
  const positiveWords = ['é–‹å¿ƒ', 'å¿«æ¨‚', 'èˆˆå¥®', 'å¹¸ç¦', 'è®š', 'çˆ½', 'å¥½åƒ', 'å¥½çŽ©', 'æ„›']
  const negativeWords = ['ç´¯', 'é›£éŽ', 'ç”Ÿæ°£', 'ç…©', 'è¨ŽåŽ­', 'å£“åŠ›', 'ç—›è‹¦', 'å¤±æœ›', 'ä¸å–œæ­¡']

  let posHits = 0
  let negHits = 0
  positiveWords.forEach(w => { if (s.includes(w)) posHits++ })
  negativeWords.forEach(w => { if (s.includes(w)) negHits++ })

  const raw = posHits - negHits
  let label = 'neutral'
  if (raw > 0) label = 'positive'
  else if (raw < 0) label = 'negative'

  // åˆ†æ•¸è¦å‰‡ï¼š
  // - æ­£å‘ï¼š>= 0.7ï¼ˆèµ·å§‹ 0.8ï¼‰
  // - ä¸­ç«‹ï¼š= 0.5
  // - è² å‘ï¼š<= 0.3ï¼ˆèµ·å§‹ 0.2ï¼‰
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
    positive: { emoji: 'ðŸ˜Š', text: 'æ­£å‘', cls: 'chip-positive' },
    neutral: { emoji: 'ðŸ˜', text: 'ä¸­ç«‹', cls: 'chip-neutral' },
    negative: { emoji: 'â˜¹ï¸', text: 'è² å‘', cls: 'chip-negative' },
  }
  const m = map[label] || map.neutral

  // æ¨™é¡ŒåŒ…å«ä¿¡å¿ƒ
  let title = label
  if (confidence !== undefined) title += ` (ä¿¡å¿ƒ: ${(confidence * 100).toFixed(1)}%)`

  // ä¿¡å¿ƒå°æ‡‰é£½å’Œåº¦ï¼ˆ0.3~1.0ï¼‰ï¼Œé¿å…éŽæ·¡
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
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>é—œéµè©ž</div>
          <span className="kw-tags">
            {topTokens.slice(0, 8).map((t, i) => {
              const tagCls = t.label === 'neg' ? 'kw-neg' : (t.label === 'pos' ? 'kw-pos' : 'kw-neu')
              const pct = typeof t.contrib === 'number' ? (t.contrib * 100).toFixed(1) : 'â€“'
              return (
                <span key={i} className={`kw-tag ${tagCls}`} title={`è²¢ç»åº¦ ${pct}%`}>
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
  if (score == null) return { emoji: 'â€“', text: 'ç„¡è³‡æ–™', color: '#9ca3af' }
  if (score < 0.3) return { emoji: 'â˜¹ï¸', text: 'è² å‘', color: '#ef4444' }
  if (score > 0.7) return { emoji: 'ðŸ˜Š', text: 'æ­£å‘', color: '#10b981' }
  return { emoji: 'ðŸ˜', text: 'ä¸­ç«‹', color: '#6b7280' }
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

// Use remote API if available; map to { label, score, confidence, topTokens }
async function analyzeSentimentViaApi(text) {
  try {
    const r = await inferSentiment(text)
    
    // æª¢æŸ¥ API éŸ¿æ‡‰æ˜¯å¦æˆåŠŸ
    if (!r.ok) {
      throw new Error('API response not ok')
    }
    
    // æ˜ å°„æ–°çš„æ¨™ç±¤æ ¼å¼
    const labelMap = {
      'pos': 'positive',
      'neu': 'neutral', 
      'neg': 'negative'
    }
    
    const mappedLabel = labelMap[r.label] || 'neutral'
    
    // è¨ˆç®—åˆ†æ•¸ï¼šä½¿ç”¨æ¦‚çŽ‡åˆ†å¸ƒ
    let score = 0.5
    if (r.probs && typeof r.probs === 'object') {
      const { neg, neu, pos } = r.probs
      // å°‡æ¦‚çŽ‡è½‰æ›ç‚º 0-1 åˆ†æ•¸ï¼šè² å‘=0, ä¸­ç«‹=0.5, æ­£å‘=1
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
  // Search & date filters
  const [searchQuery, setSearchQuery] = useState('')
  const today = new Date()
  // é è¨­æ”¹ç‚ºã€Œå…¨éƒ¨ã€ï¼Œé¿å…èˆŠè³‡æ–™è¢«æœ¬æœˆç¯©æŽ‰
  const [quickPreset, setQuickPreset] = useState('all') // 'all' | 'thisMonth' | 'lastMonth' | 'custom'
  const [startDate, setStartDate] = useState(null)
  const [endDate, setEndDate] = useState(null)
  // Reminder settings
  // Settings moved to SettingsPage
  const [tab, setTab] = useState('line') // 'line' | 'heat'
  const [range, setRange] = useState('week') // 'week' | 'month'
  const [selectedDay, setSelectedDay] = useState(null) // 'YYYY-MM-DD'
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
        // å…ˆå–å¾—å¯ç”¨æ˜Žæ–‡ï¼Œå†æ ¹æ“šæ˜Žæ–‡åˆ†æžæƒ…ç·’
        let plain = null
        if (e.contentEnc) {
          plain = currentUser ? decryptText(e.contentEnc, currentUser.uid) : null
        }
        if (!plain && typeof e.content === 'string') {
          plain = String(e.content)
        }
        /* computed via local heuristic removed to avoid overwriting API */
        let sentiment = e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : analyzeSentiment(plain)
        // è‹¥èˆŠè³‡æ–™åˆ†æ•¸èˆ‡æ–°è¦å‰‡å‡ºå…¥å¾ˆå¤§ï¼Œå‰‡ä»¥æ–°è¦å‰‡è¦†è“‹ä¸¦æŽ’å…¥ä¿®è£œ
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

      // èƒŒæ™¯ä¿®è£œï¼šæŠŠä¸ä¸€è‡´çš„ sentiment åˆ†æ•¸å¯«å›ž Firestore
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
      setError(e?.message || 'è®€å–è³‡æ–™å¤±æ•—')
    } finally {
      setLoading(false)
    }
  }, [baseCol, currentUser])

  useEffect(() => { refresh() }, [refresh])

  // ç•¶é›¢ç·šæ™‚ï¼ŒæŠŠå°šæœªåŒæ­¥çš„æœ¬æ©Ÿç­†è¨˜ä¹Ÿå±•ç¤ºæ–¼åˆ—è¡¨ï¼ˆåŠ ä¸Šå¾…åŒæ­¥æ¨™è¨˜ï¼‰
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
      // è‹¥å°šæœªå®Œæˆç™»å…¥ï¼ˆcurrentUser å¯èƒ½é‚„æ²’å°±ç·’ï¼‰ï¼Œæ™šé»žé‡è©¦
      if (!currentUser) {
        setSyncStatus('ç­‰å¾…ç™»å…¥å¾ŒåŒæ­¥â€¦')
        setTimeout(() => { if (navigator.onLine) handleOnline() }, 1500)
        return
      }
      setSyncStatus('åŒæ­¥ä¸­â€¦')
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
            // å–®ç­†å¤±æ•—æ™‚ä¿ç•™åœ¨ pendingï¼Œä¸‹æ¬¡å†è©¦
            console.warn('[sync] fail one entry', e.id, entryErr?.message)
            fail++
          }
        }
        if (fail > 0) {
          setSyncStatus(`éƒ¨åˆ†å®Œæˆï¼ˆæˆåŠŸ ${ok} / å¤±æ•— ${fail}ï¼Œç¨å¾Œè‡ªå‹•é‡è©¦ï¼‰`)
        } else {
          setSyncStatus('åŒæ­¥å®Œæˆ')
        }
        setTimeout(() => setSyncStatus(''), 2000)
        refresh()
      } catch (err) {
        console.error('[sync] åŒæ­¥å¤±æ•—', err)
        setSyncStatus('åŒæ­¥å¤±æ•—ï¼Œç¨å¾Œè‡ªå‹•é‡è©¦')
        // 5 ç§’å¾Œè‡ªå‹•å†å˜—è©¦ä¸€æ¬¡ï¼ˆè‹¥ä»é›¢ç·šæˆ–ç¶²è·¯ä¸ç©©ï¼‰
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
      setSpeechEmotion(null)
      setSpeechResetKey(key => key + 1)
    } catch (e) {
      console.error(e)
      setError(e?.message || 'å­˜æª”å¤±æ•—')
    }
  }

  function summary(text, max = 30) {
    const s = String(text).replace(/\s+/g, ' ').trim()
    if (s.length <= max) return s
    return s.slice(0, max) + 'â€¦'
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
    if (!startDate && !endDate) base = 'å…¨éƒ¨æ­·å²ç´€éŒ„'
    else if (hasCustomRange) base = `${format(startDate, 'yyyy/MM/dd')} - ${format(endDate, 'yyyy/MM/dd')} æ­·å²ç´€éŒ„`
    else base = `${format((endDate || new Date()), 'yyyy/MM')} æ­·å²ç´€éŒ„`
    const q = searchQuery.trim()
    return q ? `${base}ï¼ˆå«ã€Ž${q}ã€ï¼‰` : base
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

  // åˆªé™¤åŠŸèƒ½æš«æ™‚ç§»é™¤ï¼ˆDay 13 æœƒè£œä¸Šï¼‰

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
      setError(e?.message || 'æ›´æ–°å¤±æ•—')
    }
  }

  async function softDelete(id) {
    if (!id || !currentUser || !baseCol) return
    const ok = window.confirm('ç¢ºå®šè¦åˆªé™¤é€™ç¯‡æ—¥è¨˜å—Žï¼Ÿï¼ˆå¯æ–¼åžƒåœ¾æ¡¶é‚„åŽŸï¼‰')
    if (!ok) return
    try {
      await updateDoc(doc(baseCol, id), { isDeleted: true, updatedAt: new Date().toISOString() })
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch (e) {
      console.error(e)
      setError(e?.message || 'åˆªé™¤å¤±æ•—')
    }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="title" style={{ marginBottom: 0 }}>éœ“çš„æƒ…ç·’æ—¥è¨˜</h1>
        <div>
          <Link to="/settings" style={{ marginRight: '0.75rem', fontSize: 14 }}>è¨­å®š</Link>
          <Link to="/trash" style={{ marginRight: '0.75rem', fontSize: 14 }}>åžƒåœ¾æ¡¶</Link>
          <span style={{ marginRight: '0.75rem', color: '#666', fontSize: 14 }}>{currentUser?.displayName}</span>
          <button className="btn btn-outline" onClick={logout}>ç™»å‡º</button>
        </div>
      </div>

      {isOffline && (
        <div className="toast toast-error" style={{ position: 'static', marginTop: 8 }}>
          ç›®å‰ç‚ºé›¢ç·šæ¨¡å¼ï¼Œç­†è¨˜æœƒå…ˆå„²å­˜åœ¨æœ¬æ©Ÿä¸¦æ–¼æ¢å¾©ç¶²è·¯å¾Œè‡ªå‹•åŒæ­¥ã€‚
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
            <button className={`btn ${quickPreset === 'all' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('all')}>å…¨éƒ¨</button>
            <button className={`btn ${quickPreset === 'thisMonth' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('thisMonth')}>æœ¬æœˆ</button>
            <button className={`btn ${quickPreset === 'lastMonth' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('lastMonth')}>ä¸Šæœˆ</button>
            <button className={`btn ${quickPreset === 'custom' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => applyPreset('custom')}>è‡ªè¨‚</button>

            {/* custom date range moved below to keep search aligned */}
          </div>

          <input
            className="input search-inline"
            type="text"
            placeholder="æœå°‹å…§æ–‡ï¼Œä¾‹å¦‚ï¼šè€ƒè©¦ã€æ—…è¡Œã€emo"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Custom date range row - placed under the filter/search row to keep search aligned */}
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
            <span style={{ color: '#888' }}>åˆ°</span>
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

      {/* Reminder settings moved to /settings */}

      <div className="editor">
        <label htmlFor="content" className="label">æ—¥è¨˜å…§å®¹</label>
        <textarea
          id="content"
          className="textarea"
          placeholder="è¼¸å…¥ä»Šå¤©çš„å¿ƒæƒ…..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexGrow: 1, minWidth: 0 }}>
            <VoiceInput getContent={() => content} setContent={setContent} />
            <SpeechEmotionRecorder
              onEmotion={setSpeechEmotion}
              onBusyChange={setSpeechBusy}
              resetKey={speechResetKey}
            />
            {speechEmotion && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#666' }}>語音情緒</span>
                {sentimentView(speechEmotion)}
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '0 8px', height: 30 }}
                  onClick={() => {
                    setSpeechEmotion(null)
                    setSpeechResetKey(key => key + 1)
                  }}
                >
                  清除
                </button>
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave} style={{ marginLeft: 'auto' }}>儲存</button>
        </div>
      </div>

      <div className="list">
        <h2 className="subtitle">{hasActiveFilter ? `${filterTitle()}ï¼ˆç¯©é¸å¾Œå…± ${sortedFiltered.length} ç¯‡ï¼‰` : 'æ‰€æœ‰æ—¥è¨˜'}</h2>
        {loading ? (
          <p className="empty">è¼‰å…¥ä¸­â€¦</p>
        ) : sortedFiltered.length === 0 ? (
          <p className="empty">å°šç„¡æ—¥è¨˜ï¼Œå¯«ä¸‹ç¬¬ä¸€ç­†å§ï¼</p>
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
                        <span className="chip chip-pending" title="å°šæœªåŒæ­¥">å¾…åŒæ­¥</span>
                      )}
                    </>
                  )}
                </div>
                {editingId === e.id ? (
                  <div className="entry-actions">
                    <button className="btn btn-primary" onClick={() => saveEdit(e.id)}>å„²å­˜</button>
                    <button className="btn btn-secondary" onClick={() => { setEditingId(null); setEditingText('') }}>å–æ¶ˆ</button>
                  </div>
                ) : (
                  <div className="entry-actions">
                    <button className="btn btn-outline" onClick={() => startEdit(e.id, e.content)}>ç·¨è¼¯</button>
                    <button className="btn btn-danger" onClick={() => softDelete(e.id)}>åˆªé™¤</button>
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
        <h2 className="subtitle">æƒ…ç·’è¦–è¦ºåŒ–</h2>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className={`btn ${tab === 'line' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('line')}>æŠ˜ç·šåœ–</button>
          <button className={`btn ${tab === 'heat' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('heat')}>ç†±åŠ›åœ–</button>
        </div>

        {tab === 'line' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className={`btn ${range === 'week' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => setRange('week')}>æœ€è¿‘ 7 å¤©</button>
              <button className={`btn ${range === 'month' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => setRange('month')}>æœ€è¿‘ 30 å¤©</button>
            </div>
            {loading ? (
              <p className="empty">è¼‰å…¥ä¸­â€¦</p>
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
                        return [`${s?.toFixed?.(2)} ${m.emoji} ${m.text}`, 'æƒ…ç·’']
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
              <p className="empty">è¼‰å…¥ä¸­â€¦</p>
            ) : (
              <>
                <div className="heatmap">
                  <div className="heatmap-grid">
                    {['æ—¥','ä¸€','äºŒ','ä¸‰','å››','äº”','å…­'].map((d) => (
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
                          title={isFuture ? `${d.date} - æœªä¾†` : `${d.date}${score != null ? ` - å¹³å‡ ${score.toFixed(2)}` : ''}`}
                          onClick={() => !isFuture && setSelectedDay(d.date)}
                          disabled={isFuture}
                        >
                          <span className="heat-day">{d.day}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="heat-legend">
                    <span className="legend neg">è² å‘</span>
                    <span className="legend neutral">ä¸­ç«‹</span>
                    <span className="legend pos">æ­£å‘</span>
                  </div>
                </div>

                {selectedDay && (
                  <div style={{ marginTop: 12 }}>
                    <h2 className="subtitle">{format(parseISO(selectedDay), 'yyyy/MM/dd')} çš„æ—¥è¨˜</h2>
                    {selectedDayItems.length === 0 ? (
                      <p className="empty">ç•¶æ—¥æ²’æœ‰æ—¥è¨˜</p>
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
                                  const text = label === 'positive' ? 'æ­£å‘' : (label === 'negative' ? 'è² å‘' : 'ä¸­ç«‹')
                                  return (
                                    <span className={`chip ${cls}`} style={{ padding: '0 10px', height: 22, lineHeight: '22px' }}>{text}</span>
                                  )
                                })()}
                                <span style={{ fontSize: 13, color: '#9ca3af' }}>ï½œ é—œéµå­—top5ï¼š</span>
                                <span className="kw-tags" style={{ marginLeft: 0 }}>
                                  {(Array.isArray(e.sentiment?.topTokens) ? e.sentiment.topTokens.slice(0, 5) : []).map((t, i) => (
                                    <span key={i} className={`kw-tag ${t.label === 'neg' ? 'kw-neg' : (t.label === 'pos' ? 'kw-pos' : 'kw-neu')}`}>{t.text}</span>
                                  ))}
                                  {(!Array.isArray(e.sentiment?.topTokens) || e.sentiment.topTokens.length === 0) && (
                                    <span style={{ fontSize: 13, color: '#9ca3af' }}>â€”</span>
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

function SpeechEmotionRecorder({ onEmotion, onBusyChange, resetKey }) {
  const isClient = typeof navigator !== 'undefined'
  const initialSupport = isClient && !!(navigator?.mediaDevices && window.MediaRecorder)
  const [supported, setSupported] = useState(initialSupport)
  const [recording, setRecording] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [audioUrl, setAudioUrl] = useState('')

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])

  useEffect(() => {
    if (!supported && isClient) {
      const ok = !!(navigator?.mediaDevices && window.MediaRecorder)
      setSupported(ok)
      if (!ok) onBusyChange?.(false)
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!audioUrl) return undefined
    return () => { URL.revokeObjectURL(audioUrl) }
  }, [audioUrl])

  useEffect(() => {
    onEmotion?.(null)
    setError('')
    setRecording(false)
    setLoading(false)
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl('')
    }
    chunksRef.current = []
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop() } catch {}
      mediaRecorderRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }, [resetKey])

  async function startRecording() {
    if (loading || recording) return
    setError('')
    onEmotion?.(null)
    if (!supported) {
      setError('瀏覽器不支援錄音')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) chunksRef.current.push(evt.data)
      }
      recorder.onstop = () => {
        setRecording(false)
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        chunksRef.current = []
        handleBlob(blob)
      }
      mediaRecorderRef.current = recorder
      streamRef.current = stream
      recorder.start()
      setRecording(true)
      onBusyChange?.(true)
    } catch (err) {
      console.error('[speech] recorder start failed', err)
      setError(err?.message || '無法開始錄音')
      onBusyChange?.(false)
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    try { recorder.stop() } catch {}
  }

  function clearAll() {
    if (recording) stopRecording()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    chunksRef.current = []
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl('')
    }
    setError('')
    setLoading(false)
    setRecording(false)
    onEmotion?.(null)
    onBusyChange?.(false)
  }

  async function handleBlob(blob) {
    try {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
        setAudioUrl('')
      }
      const url = URL.createObjectURL(blob)
      setAudioUrl(url)
      setLoading(true)
      const resp = await inferSpeechEmotion(blob)
      const mapped = mapSpeechEmotion(resp)
      onEmotion?.(mapped)
      setError('')
    } catch (err) {
      console.error('[speech] infer failed', err)
      setError(err?.message || '語音情緒辨識失敗')
      onEmotion?.(null)
    } finally {
      setLoading(false)
      onBusyChange?.(false)
    }
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

  if (!supported) {
    return <span style={{ fontSize: 12, color: '#9ca3af' }}>語音錄製不支援</span>
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {!recording ? (
        <button className="btn btn-secondary" type="button" onClick={startRecording} disabled={loading}>
          錄音情緒
        </button>
      ) : (
        <button className="btn btn-danger" type="button" onClick={stopRecording}>
          停止錄音
        </button>
      )}
      <button className="btn btn-outline" type="button" onClick={clearAll} disabled={loading && !recording}>
        清空
      </button>
      {loading && <span style={{ fontSize: 12, color: '#9ca3af' }}>分析中…</span>}
      {recording && !loading && <span style={{ fontSize: 12, color: '#9ca3af' }}>錄音中</span>}
      {audioUrl && !recording && (
        <audio src={audioUrl} controls style={{ height: 32 }} />
      )}
      {error && <span style={{ fontSize: 12, color: 'crimson' }}>{error}</span>}
    </div>
  )
}
function VoiceInput({ getContent, setContent }) {
  const [recog, setRecog] = useState(null)
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const [err, setErr] = useState('')
  const [interim, setInterim] = useState('')
  const baseRef = useRef('')
  const finalRef = useRef('')
  const lastAppendAtRef = useRef(0)

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) setSupported(false)
  }, [])

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
        // è½‰æ›å£ä»¤ç‚ºæ¨™é»ž
        const normalizeChunk = (s) => {
          if (!s) return ''
          let t = String(s)
          // èªžéŸ³å£ä»¤ â†’ æ¨™é»ž
          t = t.replace(/é€—[é»žç‚¹]/g, 'ï¼Œ')
               .replace(/å¥[è™Ÿå·ç‚¹]/g, 'ã€‚')
               .replace(/å•[è™Ÿå·]/g, 'ï¼Ÿ')
               .replace(/é©šå˜†[è™Ÿå·]|æ„Ÿå˜†[è™Ÿå·]/g, 'ï¼')
               .replace(/å†’[è™Ÿå·]/g, 'ï¼š')
               .replace(/åˆ†[è™Ÿå·]/g, 'ï¼›')
               .replace(/é “[è™Ÿå·]/g, 'ã€')
               .replace(/æ›è¡Œ/g, '\n')
               .replace(/ç©ºæ ¼/g, ' ')
          return t
        }
        newFinal = normalizeChunk(newFinal)
        interimText = normalizeChunk(interimText)

        // ä¾åœé “æ™‚é–“è‡ªå‹•è£œé€—é»žï¼šè‹¥è·é›¢ä¸Šæ¬¡ç¢ºå®šæ–‡å­— > 1200ms ä¸”æœ€å¾Œä¸€å­—éžæ¨™é»žï¼Œå…ˆè£œé€—é»ž
        if (newFinal) {
          const now = Date.now()
          const needComma = finalRef.current && !/[ï¼Œã€‚ï¼ï¼Ÿï¼›ã€ï¼š\n]$/.test(finalRef.current) && (now - (lastAppendAtRef.current || 0) >= 1200)
          if (needComma) finalRef.current += 'ï¼Œ'
          lastAppendAtRef.current = now
        }

        if (newFinal) finalRef.current += newFinal
        const display = `${baseRef.current}${finalRef.current}${interimText}`
        setContent && setContent(display)
        setInterim(interimText)
      } catch {}
    }
    r.onerror = (e) => {
      // å¿½ç•¥ aborted/no-speechï¼Œé¿å…é¡¯ç¤ºéŒ¯èª¤
      const code = e?.error || ''
      if (code !== 'aborted' && code !== 'no-speech') setErr(code || 'speech error')
      setListening(false)
      setInterim('')
    }
    r.onend = () => {
      setListening(false)
      setContent && setContent(`${baseRef.current}${finalRef.current}`)
      setInterim('')
      setRecog(null)
    }
  }

  function start() {
    setErr('')
    if (listening) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setSupported(false); return }
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
    try { r.start(); setRecog(r); setListening(true) } catch {}
  }
  function stop() {
    const r = recog
    if (!r) { setListening(false); return }
    try { r.stop() } catch {}
    try { r.abort() } catch {}
    setListening(false)
    setInterim('')
  }

  if (!supported) {
    return <span style={{ fontSize: 12, color: '#9ca3af' }}>æ­¤ç€è¦½å™¨ä¸æ”¯æ´èªžéŸ³è¼¸å…¥</span>
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button className={`btn ${listening ? 'btn-danger' : 'btn-secondary'}`} onClick={listening ? stop : start}>
        {listening ? 'åœæ­¢èªžéŸ³è¼¸å…¥' : 'é–‹å§‹èªžéŸ³è¼¸å…¥'}
      </button>
      {listening && <span style={{ fontSize: 12, color: '#9ca3af' }}>è†è½ä¸­â€¦è«‹é–‹å§‹èªªè©±</span>}
      {err && <span style={{ fontSize: 12, color: 'crimson' }}>{err}</span>}
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











