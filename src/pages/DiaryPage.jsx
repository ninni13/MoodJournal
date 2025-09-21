import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CryptoJS from 'crypto-js'
import { addPending, getAllPending, deletePending } from '../lib/idb.js'
import { Link } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isAfter, subDays, subMonths } from 'date-fns'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ReferenceLine } from 'recharts'
import { useAuth } from '../state/AuthContext.jsx'
import { db, logout } from '../lib/firebase.js'
import { predictFusion } from '../lib/fusion'
import { collection, doc, getDocs, getDoc, orderBy, query, updateDoc, setDoc } from 'firebase/firestore'
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

// ===== 本地簡易情緒，僅作備援（API 壞掉時）
function analyzeSentimentLocal(text) {
  const s = String(text || '')
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

  let score
  if (label === 'positive') score = Math.min(1, 0.8 + Math.max(0, posHits - 1) * 0.05)
  else if (label === 'negative') score = Math.max(0, 0.2 - Math.max(0, negHits - 1) * 0.05)
  else score = 0.5

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

  let title = label
  if (confidence !== undefined) title += ` (信心: ${(confidence * 100).toFixed(1)}%)`
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

// ===== 簡易 AES：以使用者 uid 當 key（示範用）
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

const FUSION_LABEL_MAP = { pos: 'positive', neu: 'neutral', neg: 'negative' }

function sentimentFromFusion(data) {
  if (!data || typeof data !== 'object') return null
  const fusionPred = data.fusion_pred && typeof data.fusion_pred === 'object' ? data.fusion_pred : {}
  const topKey = typeof data.fusion_top1 === 'string' ? data.fusion_top1 : 'neu'
  const label = FUSION_LABEL_MAP[topKey] || 'neutral'
  const pos = typeof fusionPred.pos === 'number' ? fusionPred.pos : 0
  const neu = typeof fusionPred.neu === 'number' ? fusionPred.neu : 0
  const scoreRaw = pos + neu * 0.5
  const confidence = typeof fusionPred[topKey] === 'number'
    ? Math.max(0, Math.min(1, fusionPred[topKey]))
    : undefined

  return {
    label,
    score: Math.max(0, Math.min(1, scoreRaw)),
    confidence,
    source: 'fusion',
    topTokens: [],
    probs: fusionPred,
    fusion: {
      alpha: typeof data.alpha === 'number' ? data.alpha : undefined,
      labels: Array.isArray(data.labels) && data.labels.length
        ? data.labels
        : ['pos', 'neu', 'neg'],
      textPred: data.text_pred || null,
      audioPred: data.audio_pred || null,
      fusionPred,
      textTop1: data.text_top1 || null,
      audioTop1: data.audio_top1 || null,
      fusionTop1: data.fusion_top1 || null,
    },
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
  const [quickPreset, setQuickPreset] = useState('all') // 'all' | 'thisMonth' | 'lastMonth' | 'custom'
  const [startDate, setStartDate] = useState(null)
  const [endDate, setEndDate] = useState(null)
  // 圖表
  const [tab, setTab] = useState('line')   // 'line' | 'heat'
  const [range, setRange] = useState('week') // 'week' | 'month'
  const [selectedDay, setSelectedDay] = useState(null) // 'YYYY-MM-DD'
  // 語音：我們改成「儲存時才打語音情緒 API」，故保留 blob 在父層
  const [speechBlob, setSpeechBlob] = useState(null)        // <-- 錄音檔
  const [speechMime, setSpeechMime] = useState('')          // <-- mime
  const [speechBusy, setSpeechBusy] = useState(false)
  const [speechResetKey, setSpeechResetKey] = useState(0)
  const [analyseBusy, setAnalyseBusy] = useState(false)
  const [fusionAlpha, setFusionAlpha] = useState(0.5)
  const [textProbs, setTextProbs] = useState(null)
  const [audioProbs, setAudioProbs] = useState(null)
  const [fusionProbs, setFusionProbs] = useState(null)
  const [fusionTop1, setFusionTop1] = useState('')
  const [analysisToast, setAnalysisToast] = useState({ msg: '', kind: 'success' })
  const analysisToastTimerRef = useRef(null)

  function showAnalysisToast(msg, kind = 'error', duration = 2800) {
    if (!msg) return
    setAnalysisToast({ msg, kind })
    if (analysisToastTimerRef.current) clearTimeout(analysisToastTimerRef.current)
    analysisToastTimerRef.current = setTimeout(() => {
      setAnalysisToast({ msg: '', kind: 'success' })
      analysisToastTimerRef.current = null
    }, Math.max(800, duration))
  }

  const baseCol = useMemo(() => {
    if (!currentUser) return null
    return collection(db, 'users', currentUser.uid, 'diaries')
  }, [currentUser])

  const refresh = useCallback(async () => {
    if (!baseCol || !currentUser) return
    setLoading(true)
    setError('')
    try {
      const q1 = query(baseCol, orderBy('date', 'desc'))
      const snap1 = await getDocs(q1)
      const diaries = snap1.docs.map(d => ({ id: d.id, ...d.data() }))

      // 兼容舊 collection: users/uid/diary
      let oldOnes = []
      try {
        const oldCol = collection(db, 'users', currentUser.uid, 'diary')
        const q2 = query(oldCol, orderBy('date', 'desc'))
        const snap2 = await getDocs(q2)
        oldOnes = snap2.docs.map(d => ({ id: d.id, ...d.data(), __legacy: true }))
      } catch (err) {
        console.warn('[migrate] legacy read skipped:', err?.code || err?.message)
      }

      // 防呆：有人誤存到 users/uid/diaries（字串 "uid"）
      let wrongUidOnes = []
      try {
        const wrongUidCol = collection(db, 'users', 'uid', 'diaries')
        const q3 = query(wrongUidCol, orderBy('date', 'desc'))
        const snap3 = await getDocs(q3)
        wrongUidOnes = snap3.docs.map(d => ({ id: d.id, ...d.data(), __wrongUid: true }))
      } catch (err) {
        console.warn('[migrate] users/uid/diaries skipped:', err?.code || err?.message)
      }

      const patchList = []
      const normalizedNew = diaries.map(e => {
        let plain = null
        if (e.contentEnc) plain = currentUser ? decryptText(e.contentEnc, currentUser.uid) : null
        if (!plain && typeof e.content === 'string') plain = String(e.content)
        let sentiment = e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : analyzeSentimentLocal(plain)
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
          sentiment: e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : analyzeSentimentLocal(e.content),
        }
        if (!newIds.has(norm.id)) {
          try {
            const contentEnc = currentUser ? encryptText(norm.content, currentUser.uid) : null
            const { content, ...rest } = norm
            await setDoc(doc(baseCol, norm.id), { ...rest, contentEnc })
            toMigrate.push(norm)
          } catch (err) {
            console.warn('[migrate] write failed:', err?.code || err?.message)
          }
        }
      }

      const merged = [...normalizedNew, ...toMigrate]
        .filter(e => e.isDeleted !== true)
        .sort((a, b) => toEpoch(b.date) - toEpoch(a.date))

      setEntries(merged)

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

  useEffect(() => () => {
    if (analysisToastTimerRef.current) {
      clearTimeout(analysisToastTimerRef.current)
    }
  }, [])

  // 離線：把 IndexedDB 待同步資料拉進列表
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

  // 線上/離線偵測 + 自動同步
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
          if (navigator.onLine) handleOnline()
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

  async function onAnalyse(text, audioBlob, alpha = fusionAlpha, opts = {}) {
    const options = typeof opts === 'object' && opts !== null ? opts : {}
    const updateState = options.updateState !== false
    const showToast = options.showToast !== false

    const trimmed = String(text || '').trim()
    if (!trimmed) return null

    const hasBlob = audioBlob instanceof Blob && audioBlob.size > 0
    const alphaToUse = typeof alpha === 'number' && !Number.isNaN(alpha) ? alpha : fusionAlpha
    const data = await predictFusion(trimmed, hasBlob ? audioBlob! : undefined, alphaToUse)

    if (updateState) setAnalyseBusy(true)
    try {
      if (updateState) {
        setTextProbs(data?.text_pred || null)
        setAudioProbs(data?.audio_pred || null)
        setFusionProbs(data?.fusion_pred || null)
        setFusionTop1(data?.fusion_top1 || '')
        if (typeof data?.alpha === 'number') setFusionAlpha(data.alpha)
      }
      return data
    } catch (err) {
      if (updateState) {
        setTextProbs(null)
        setAudioProbs(null)
        setFusionProbs(null)
        setFusionTop1('')
      }
      console.error('[fusion] analyse failed', err)
      if (showToast) showAnalysisToast('融合分析失敗，請稍後再試', 'error')
      throw err
    } finally {
      if (updateState) setAnalyseBusy(false)
    }
  }

  const canAnalyse = useMemo(() => content.trim().length > 0 && !analyseBusy, [content, analyseBusy])
  const canSave = useMemo(() => content.trim().length > 0 && !speechBusy && !analyseBusy, [content, speechBusy, analyseBusy])

  async function handleAnalyseClick() {
    const text = content.trim()
    if (!text) {
      showAnalysisToast('請先輸入日記內容', 'error', 2200)
      return
    }
    try {
      await onAnalyse(text, speechBlob, fusionAlpha)
    } catch (err) {
      // 已在 onAnalyse 中處理錯誤與提示
    }
  }

  async function handleSave() {
    const text = content.trim()
    if (!text || !baseCol) return
    try {
      const id = uuid()

      let fusionData = null
      try {
        fusionData = await onAnalyse(text, speechBlob, fusionAlpha, { showToast: false })
      } catch (err) {
        console.warn('[fusion analyse on save] failed, fallback to local:', err?.message || err)
      }

      let sentiment = fusionData ? sentimentFromFusion(fusionData) : null
      if (!sentiment) {
        const fallbackLocal = analyzeSentimentLocal(text)
        sentiment = {
          ...fallbackLocal,
          confidence: typeof fallbackLocal.score === 'number' ? fallbackLocal.score : undefined,
          source: 'local-fallback',
          topTokens: Array.isArray(fallbackLocal.topTokens) ? fallbackLocal.topTokens : [],
          probs: null,
          fusion: null,
        }
      }

      const newData = {
        id,
        date: todayKey(),
        isDeleted: false,
        updatedAt: new Date().toISOString(),
        sentiment,
      }

      if (isOffline) {
        await addPending({ ...newData, content: text, isSynced: false })
        setEntries(prev => [{ id, ...newData, content: text, localPending: true }, ...prev])
      } else {
        const contentEnc = currentUser ? encryptText(text, currentUser.uid) : null
        const ref = doc(baseCol, id)
        await setDoc(ref, { ...newData, contentEnc })
        setEntries(prev => [{ id, ...newData, content: text }, ...prev])
      }

      // 清理輸入與語音狀態
      setContent('')
      setSpeechBlob(null)
      setSpeechMime('')
      setSpeechResetKey(k => k + 1)
      setTextProbs(null)
      setAudioProbs(null)
      setFusionProbs(null)
      setFusionTop1('')
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
      // custom
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

  // ===== Insights: 折線圖 =====
  const lineData = useMemo(() => {
    const now = new Date()
    const days = range === 'week' ? 7 : 30
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

  // ===== Insights: 月曆熱圖 =====
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

  const fusionLabelText = useMemo(() => ({ pos: '正向', neu: '中立', neg: '負向' }), [])

  function describeProbs(probs) {
    if (!probs || typeof probs !== 'object') return '—'
    return ['pos', 'neu', 'neg']
      .map(key => {
        const pct = typeof probs[key] === 'number' ? (probs[key] * 100).toFixed(1) : '0.0'
        const label = fusionLabelText[key] || key
        return `${label} ${pct}%`
      })
      .join(' ｜ ')
  }

  async function startEdit(id, current) {
    setEditingId(id)
    setEditingText(current)
  }

  async function saveEdit(id) {
    if (!id || !currentUser || !baseCol) return
    const text = String(editingText).trim()
    if (!text) return
    try {
      let sentiment = null
      try {
        const fusionData = await onAnalyse(text, null, fusionAlpha, { updateState: false, showToast: false })
        sentiment = fusionData ? sentimentFromFusion(fusionData) : null
      } catch (err) {
        console.warn('[fusion analyse on edit] failed, fallback to local:', err?.message || err)
      }

      if (!sentiment) {
        const fallbackLocal = analyzeSentimentLocal(text)
        sentiment = {
          ...fallbackLocal,
          confidence: typeof fallbackLocal.score === 'number' ? fallbackLocal.score : undefined,
          source: 'local-fallback',
          topTokens: Array.isArray(fallbackLocal.topTokens) ? fallbackLocal.topTokens : [],
          probs: null,
          fusion: null,
        }
      }

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
          目前為離線模式，日記會先儲存在本機並於恢復網路後自動同步。
        </div>
      )}
      {!!syncStatus && !isOffline && (
        <div className="toast toast-success" style={{ position: 'static', marginTop: 8 }}>
          {syncStatus}
        </div>
      )}
      {analysisToast.msg && (
        <div className={`toast toast-${analysisToast.kind}`} style={{ position: 'static', marginTop: 8 }}>
          {analysisToast.msg}
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
              onSpeechBusy={setSpeechBusy}
              onSpeechBlob={(blob, mime) => { setSpeechBlob(blob || null); setSpeechMime(mime || '') }}
              resetKey={speechResetKey}
            />
          </div>
          <button
            className="btn btn-secondary"
            onClick={handleAnalyseClick}
            disabled={!canAnalyse}
          >
            融合分析
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave} style={{ marginLeft: 'auto' }}>儲存</button>
        </div>
        {analyseBusy && (
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>融合分析中，請稍候…</div>
        )}
        {fusionProbs && (
          <div style={{ marginTop: 10, padding: '0.75rem', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', color: '#1f2937' }}>
            <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 4 }}>
              融合分析（α = {typeof fusionAlpha === 'number' ? fusionAlpha.toFixed(2) : '—'}）
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              融合結果：{fusionLabelText[fusionTop1] || '—'}
            </div>
            <div style={{ fontSize: 13, color: '#4b5563' }}>文字：{describeProbs(textProbs)}</div>
            <div style={{ fontSize: 13, color: '#4b5563', marginTop: 2 }}>語音：{describeProbs(audioProbs)}</div>
            <div style={{ fontSize: 13, color: '#111827', marginTop: 4 }}>融合：{describeProbs(fusionProbs)}</div>
          </div>
        )}
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

/**
 * 語音輸入元件（即時轉文字；錄音結束後回傳 Blob）
 * 變更重點：
 * 1) 先 getUserMedia 啟動 MediaRecorder，再啟動 SpeechRecognition（避免音源互搶）。
 * 2) recognition.onend 自動重啟，確保 Chrome 不會 5~15 秒就停止影響即時文字。
 * 3) 不在錄音結束就打語音情緒 API；只把 Blob 回傳父層，父層在「儲存」時再呼叫 API。
 */
function VoiceInput({ getContent, setContent, onSpeechBusy, onSpeechBlob, resetKey }) {
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
  const sessionRef = useRef(0)
  const listeningRef = useRef(false) // 給 onend 自動重啟用

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isiOS = /\b(iPad|iPhone|iPod)\b/i.test(ua)
  const isSafariEngine = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Brave/i.test(ua)

  const hasMediaRecorder = typeof window !== 'undefined' && 'MediaRecorder' in window
  const canParallelRecord = hasMediaRecorder && !(isiOS && isSafariEngine)

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) setSupported(false)
    return () => {
      stopRecorder()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      clearAudio()
    }
  }, [])

  useEffect(() => {
    if (resetKey == null) return
    stop()
    clearAudio()
    chunksRef.current = []
    setErr('')
    setInterim('')
    onSpeechBlob?.(null, '')
  }, [resetKey])

  function clearAudio() {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = ''
    }
    setAudioUrl('')
    setAudioMime('')
  }

  function stopRecorder() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop() } catch {}
    }
  }

  function attachHandlers(r) {
    let flushTimer = null
    const kickFlush = (ms = 1800) => {
      clearTimeout(flushTimer)
      flushTimer = setTimeout(() => {
        try { r.stop() } catch {}
      }, ms)
    }

    r.onstart = () => { kickFlush() }
    r.onaudiostart = () => { console.log('[SR] onaudiostart'); kickFlush() }
    r.onsoundstart = () => { kickFlush() }
    r.onspeechstart = () => { kickFlush() }
    r.onspeechend = () => { kickFlush(800) }
    r.onaudioend = () => { kickFlush(300) }

    r.onresult = (e) => {
      try {
        let interimText = ''
        let newFinal = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]
          if (res.isFinal) newFinal += res[0].transcript
          else interimText += res[0].transcript
        }
        newFinal = String(newFinal).replace(/\r?\n/g, '\n')
        interimText = String(interimText).replace(/\r?\n/g, '\n')

        if (newFinal) {
          const now = Date.now()
          const endsWithPunctuation = /[，。？！；：]$/.test(finalRef.current) || finalRef.current.endsWith('\n')
          const needComma = finalRef.current && !endsWithPunctuation && (now - (lastAppendAtRef.current || 0) >= 1200)
          if (needComma) finalRef.current += '，'
          lastAppendAtRef.current = now
        }

        if (newFinal) finalRef.current += newFinal
        const display = `${baseRef.current}${finalRef.current}${interimText}`
        setContent?.(display)
        setInterim(interimText)

        // 每次有結果都重置倒數（避免太快 flush）
        kickFlush()
      } catch (error) {
        console.error('[voice] onresult error', error)
      }
    }

    r.onerror = (e) => {
      const code = e?.error || ''
      if (code !== 'aborted' && code !== 'no-speech') setErr(code || 'speech error')
      // 交由 onend 判斷是否自動重啟
    }

    r.onend = () => {
      clearTimeout(flushTimer)
      // 你原本 onend 的內容：
      if (listeningRef.current && mediaRecorderRef.current && streamRef.current) {
        try { r.start(); return } catch { setTimeout(() => { try { r.start() } catch {} }, 200); return }
      }
      stopRecorder()
      setListening(false)
      listeningRef.current = false
      setContent?.(`${baseRef.current}${finalRef.current}`)
      setInterim('')
      setRecog(null)
      onSpeechBusy?.(false)
    }
  }

  async function start() {
    console.log('[env]', {
      ua: navigator.userAgent,
      hasMediaRecorder,
      hasSR: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      isiOS, isSafariEngine, canParallelRecord,
      isSecureContext,
      location: window.location?.origin
    })
    setErr('')
    if (listening || recording) return
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

    onSpeechBusy?.(true)
    clearAudio()
    onSpeechBlob?.(null, '')

    const sessionId = ++sessionRef.current

    baseRef.current = getContent ? (getContent() || '') : ''
    if (baseRef.current && !(baseRef.current.endsWith('\n') || baseRef.current.endsWith(' '))) baseRef.current += ' '
    finalRef.current = ''
    setInterim('')
    lastAppendAtRef.current = Date.now()

    // 依平台：iOS Safari 不同時錄音，避免 onresult 不回來
    if (canParallelRecord) {
      // === 原本的「先 getUserMedia 再開 recognition」流程 ===
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      } catch (err) {
        console.error('[speech] getUserMedia failed', err)
        setErr(err?.message || '無法開始錄音（請檢查麥克風權限）')
        onSpeechBusy?.(false)
        return
      }
      if (sessionRef.current !== sessionId) {
        stream.getTracks().forEach(t => t.stop())
        onSpeechBusy?.(false)
        return
      }

      let recorder
      try {
        recorder = new MediaRecorder(stream)
        chunksRef.current = []
        recorder.ondataavailable = (evt) => { if (evt.data && evt.data.size > 0) chunksRef.current.push(evt.data) }
        recorder.onstop = () => {
          mediaRecorderRef.current = null
          setRecording(false)
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
          }
          const mime = (recorder.mimeType && recorder.mimeType.startsWith('audio/')) ? recorder.mimeType : 'audio/webm;codecs=opus'
          const blob = new Blob(chunksRef.current, { type: mime })
          chunksRef.current = []
          handleBlob(blob, mime)
        }
      } catch (err) {
        console.error('[speech] recorder init failed', err)
        setErr(err?.message || '無法開始錄音')
        stream.getTracks().forEach(t => t.stop())
        onSpeechBusy?.(false)
        return
      }

      mediaRecorderRef.current = recorder
      streamRef.current = stream
      try { recorder.start(500) } catch { try { recorder.start() } catch (err2) {
        console.error('[speech] recorder start failed', err2)
        setErr(err2?.message || '無法開始錄音')
        stream.getTracks().forEach(t => t.stop())
        mediaRecorderRef.current = null
        streamRef.current = null
        onSpeechBusy?.(false)
        return
      }}
      setRecording(true)
    } else {
      if (!hasMediaRecorder) {
        console.warn('[speech] 此環境偵測不到 MediaRecorder，僅啟動語音辨識（情緒改用文字備援）')
      } else if (isiOS && isSafariEngine) {
        console.warn('[speech] iOS Safari 偵測到，僅啟動辨識（情緒改用文字備援）')
      } else {
        console.warn('[speech] 已停用並行錄音（除錯模式或其他限制），僅啟動辨識')
      }
    }

    // 啟動辨識
    const recognition = new SR()
    recognition.lang = 'zh-TW'
    recognition.interimResults = true
    recognition.continuous = true
    attachHandlers(recognition)

    try {
      recognition.start()
      setRecog(recognition)
      setListening(true)
      listeningRef.current = true
    } catch (err) {
      console.error('[speech] recognition start failed', err)
      setErr(err?.message || '語音辨識啟動失敗')
      try { mediaRecorderRef.current?.stop() } catch {}
      streamRef.current?.getTracks?.().forEach(t => t.stop())
      mediaRecorderRef.current = null
      streamRef.current = null
      onSpeechBusy?.(false)
      return
    }
  }


  function stop() {
    sessionRef.current += 1
    listeningRef.current = false
    const r = recog
    if (r) {
      try { r.stop() } catch {}
      try { r.abort() } catch {}
    }
    stopRecorder()
    setRecording(false)
    setListening(false)
    setInterim('')
    onSpeechBusy?.(false)
  }

  async function handleBlob(blob, mimeUsed = 'audio/webm;codecs=opus') {
    try {
      clearAudio()
      if (!blob || !blob.size) {
        console.warn('[speech] empty blob')
        setErr('錄音內容為空，請再試一次')
        onSpeechBlob?.(null, '')
        return
      }
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      setAudioUrl(url)
      setAudioMime(mimeUsed || 'audio/webm;codecs=opus')
      onSpeechBlob?.(blob, mimeUsed || 'audio/webm;codecs=opus')
      setErr('')
      console.log('[speech] blob ready:', mimeUsed, blob.size, 'bytes')
    } catch (err) {
      console.error('[speech] handleBlob failed', err)
      setErr(err?.message || '語音處理失敗')
      onSpeechBlob?.(null, '')
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
    if (input && typeof input === 'object') {
      if (typeof input.toDate === 'function') {
        const d = input.toDate()
        return format(d, 'yyyy-MM-dd')
      }
      if (input instanceof Date && !Number.isNaN(input)) {
        return format(input, 'yyyy-MM-dd')
      }
    }
    const s = String(input || '').trim()
    if (!s) return todayKey()
    const parts = s.replace(/[^0-9]+/g, '-').split('-').filter(Boolean)
    const now = new Date()
    let y, m, d
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        y = Number(parts[0])
        m = Number(parts[1])
        d = Number(parts[2])
      } else {
        y = Number(parts[2])
        if (y < 100) y = 2000 + y
        m = Number(parts[0])
        d = Number(parts[1])
      }
    } else if (parts.length === 2) {
      y = now.getFullYear()
      m = Number(parts[0])
      d = Number(parts[1])
    } else if (parts.length === 1 && parts[0].length >= 8) {
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
