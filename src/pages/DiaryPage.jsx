import EmotionChip from '../components/EmotionChip.jsx'
import EmotionInsights from '../components/EmotionInsights.jsx'
import { EMOTION_META, analyzeEmotionLocal as analyzeSentimentLocal } from '../lib/emotions.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CryptoJS from 'crypto-js'
import { addPending, getAllPending, deletePending } from '../lib/idb.js'
import { Link } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, parseISO, subMonths } from 'date-fns'
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
function sentimentFromFusion(data) {
  if (!data || typeof data !== 'object') return null

  const fusionPred =
    data.fusion_pred && typeof data.fusion_pred === 'object'
      ? data.fusion_pred
      : {}

  const label =
    typeof data.fusion_top1 === 'string'
      ? data.fusion_top1
      : 'Neutral'

  const confidence =
    typeof data.confidence === 'number'
      ? data.confidence
      : (
          typeof fusionPred[label] === 'number'
            ? fusionPred[label]
            : undefined
        )

  return {
    label,
    confidence,
    source: data.mode === 'multimodal'
      ? 'fusion'
      : 'text-only',
    probs: fusionPred,

    fusion: {
      mode: data.mode,
      labels: Array.isArray(data.labels)
        ? data.labels
        : Object.keys(EMOTION_META),

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
  // 語音：我們改成「儲存時才打語音情緒 API」，故保留 blob 在父層
  const [speechBlob, setSpeechBlob] = useState(null)        // <-- 錄音檔
  const [speechMime, setSpeechMime] = useState('')          // <-- mime
  const [speechBusy, setSpeechBusy] = useState(false)
  const [speechResetKey, setSpeechResetKey] = useState(0)
  const [analyseBusy, setAnalyseBusy] = useState(false)
  const [textProbs, setTextProbs] = useState(null)
  const [audioProbs, setAudioProbs] = useState(null)
  const [fusionProbs, setFusionProbs] = useState(null)
  const [fusionTop1, setFusionTop1] = useState('')
  const [fusionTokens, setFusionTokens] = useState([])
  const [analysisToast, setAnalysisToast] = useState({ msg: '', kind: 'success' })
  const analysisToastTimerRef = useRef(null)
  const [keepAudio, setKeepAudio] = useState(true)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef(null)

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

  useEffect(() => {
    let cancelled = false
    if (!currentUser) {
      setKeepAudio(true)
      return () => { cancelled = true }
    }
    async function loadPrefs() {
      try {
        const ref = doc(db, 'users', currentUser.uid, 'profile', 'default')
        const snap = await getDoc(ref)
        if (!snap.exists()) {
          if (!cancelled) setKeepAudio(true)
          return
        }
        const data = snap.data() || {}
        if (!cancelled) {
          if (typeof data.keepAudio === 'boolean') setKeepAudio(data.keepAudio)
          else setKeepAudio(true)
        }
      } catch (err) {
        console.warn('[settings] keepAudio load failed:', err?.code || err?.message || err)
        if (!cancelled) setKeepAudio(true)
      }
    }
    loadPrefs()
    return () => { cancelled = true }
  }, [currentUser])

  useEffect(() => {
    if (!keepAudio) {
      setSpeechBlob(null)
      setSpeechMime('')
      setAudioProbs(null)
    }
  }, [keepAudio])

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

  useEffect(() => {
    if (!userMenuOpen) return undefined

    function closeMenu(event) {
      if (event.type === 'keydown' && event.key !== 'Escape') return
      if (event.type === 'pointerdown' && userMenuRef.current?.contains(event.target)) return
      setUserMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeMenu)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeMenu)
    }
  }, [userMenuOpen])

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

  async function onAnalyse(text, audioBlob, opts = {}) {
    const options = typeof opts === 'object' && opts !== null ? opts : {}
    const updateState = options.updateState !== false
    const showToast = options.showToast !== false

    const trimmed = String(text || '').trim()
    if (!trimmed) return null

    const hasBlob = audioBlob instanceof Blob && audioBlob.size > 0
    const shouldAttachAudio = keepAudio && hasBlob
    if (updateState) setAnalyseBusy(true)
    try {
      console.log('[fusion] text len', trimmed.length, 'audio?', shouldAttachAudio, shouldAttachAudio ? audioBlob.type : '(none)', shouldAttachAudio ? audioBlob.size : 0)
      const data = await predictFusion(
        trimmed,
        shouldAttachAudio ? audioBlob : undefined
      )
      const tokens = Array.isArray(data?.text_top_tokens) ? data.text_top_tokens.slice(0, 5) : []

      if (updateState) {
        setTextProbs(data?.text_pred || null)
        setAudioProbs(keepAudio ? (data?.audio_pred || null) : null)
        setFusionProbs(data?.fusion_pred || null)
        setFusionTop1(data?.fusion_top1 || '')
        setFusionTokens(tokens)
      }
      if (showToast) showAnalysisToast('情緒分析完成', 'success', 2000)
      return data
    } catch (err) {
      if (updateState) {
        setTextProbs(null)
        setAudioProbs(null)
        setFusionProbs(null)
        setFusionTop1('')
        setFusionTokens([])
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
      await onAnalyse(text, speechBlob)
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
        fusionData = await onAnalyse(text, speechBlob, { showToast: false })
      } catch (err) {
        console.warn('[fusion analyse on save] failed, fallback to local:', err?.message || err)
      }

      const fusionTokensFromData = Array.isArray(fusionData?.text_top_tokens)
        ? fusionData.text_top_tokens.slice(0, 5)
        : []
      let sentiment = fusionData ? sentimentFromFusion(fusionData, fusionTokensFromData) : null
      if (!sentiment) {
        const fallbackLocal = analyzeSentimentLocal(text)
        sentiment = {
          ...fallbackLocal,
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
      setFusionTokens([])
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

  const fusionLabelText = useMemo(() => ({
  Anger: '生氣',
  Disgust: '厭惡',
  Fear: '害怕',
  Happy: '開心',
  Neutral: '中立',
  Sad: '難過',
  Surprise: '驚訝',
}), [])

function describeProbs(probs) {
  if (!probs || typeof probs !== 'object') return '—'

  return [
    'Anger',
    'Disgust',
    'Fear',
    'Happy',
    'Neutral',
    'Sad',
    'Surprise',
  ]
    .map(key => {
      const pct =
        typeof probs[key] === 'number'
          ? (probs[key] * 100).toFixed(1)
          : '0.0'

      return `${fusionLabelText[key]} ${pct}%`
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
        const fusionData = await onAnalyse(text, null, { updateState: false, showToast: false })
        const tokensFromData = Array.isArray(fusionData?.text_top_tokens) ? fusionData.text_top_tokens.slice(0, 5) : []
        sentiment = fusionData ? sentimentFromFusion(fusionData, tokensFromData) : null
      } catch (err) {
        console.warn('[fusion analyse on edit] failed, fallback to local:', err?.message || err)
      }

      if (!sentiment) {
        const fallbackLocal = analyzeSentimentLocal(text)
        sentiment = {
          ...fallbackLocal,
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

  const displayName = currentUser?.displayName?.trim()?.split(/\s+/)[0] || '你'
  const hour = new Date().getHours()
  const greeting = hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安'
  const todayLabel = new Intl.DateTimeFormat('zh-TW', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())

  return (
    <div className="container">
      <header className="app-header">
        <Link to="/" className="brand" aria-label="情緒日記首頁">
          <img className="brand-mark" src="/icon.png" alt="" aria-hidden="true" />
          <span>情緒日記</span>
        </Link>
        <nav className="top-nav" aria-label="主要導覽">
          <a className="nav-link active" href="#journal-list">日記</a>
          <a className="nav-link" href="#insights">情緒趨勢</a>
          <Link className="nav-link" to="/settings">設定</Link>
          <div className="user-menu" ref={userMenuRef}>
            <button
              className="avatar-button"
              onClick={() => setUserMenuOpen(open => !open)}
              aria-label="開啟使用者選單"
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
            >
              {displayName.slice(0, 1).toUpperCase()}
            </button>
            {userMenuOpen && (
              <div className="user-menu-popover" role="menu">
                <div className="user-menu-profile">
                  <strong>{currentUser?.displayName || '使用者'}</strong>
                  {currentUser?.email && <span>{currentUser.email}</span>}
                </div>
                <button role="menuitem" onClick={logout}>登出</button>
              </div>
            )}
          </div>
        </nav>
      </header>

      <main>
        <section className="welcome-section" aria-labelledby="welcome-title">
          <p className="eyebrow">{todayLabel}</p>
          <h1 id="welcome-title" className="welcome-title">{greeting}，{displayName}</h1>
          <p className="welcome-copy">留一點時間給自己。此刻，你的心情是什麼樣子？</p>
        </section>

        <section className="composer-card" aria-labelledby="composer-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">今日記錄</p>
              <h2 id="composer-title">寫下此刻的感受</h2>
            </div>
            <span className="privacy-badge">僅你可見</span>
          </div>

          <div className="editor">
            <label htmlFor="content" className="sr-only">日記內容</label>
            <textarea
              id="content"
              className="textarea composer-textarea"
              placeholder="不需要想得太完整，從現在最想說的一句話開始……"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
            />
            <div className="composer-actions">
              <div className="composer-tools">
                <VoiceInput
                  getContent={() => content}
                  setContent={setContent}
                  onSpeechBusy={setSpeechBusy}
                  onSpeechBlob={(blob, mime) => {
                    if (keepAudio && blob) {
                      setSpeechBlob(blob || null)
                      setSpeechMime(mime || '')
                    } else {
                      setSpeechBlob(null)
                      setSpeechMime('')
                    }
                  }}
                  resetKey={speechResetKey}
                />
                <button
                  className="btn btn-secondary"
                  onClick={handleAnalyseClick}
                  disabled={!canAnalyse}
                  aria-busy={analyseBusy}
                >
                  {analyseBusy && <span className="analysis-spinner" aria-hidden="true" />}
                  {analyseBusy ? '分析中…' : '分析此刻的情緒'}
                </button>
              </div>
              <button className="btn btn-primary save-button" onClick={handleSave} disabled={!canSave}>儲存日記</button>
            </div>
            {analyseBusy && (
              <div className="analysis-status" role="status" aria-live="polite">
                正在分析文字{speechBlob ? '與錄音' : ''}，請稍候…
              </div>
            )}
            {fusionProbs && (
              <div className="analysis-card">
                <span className="analysis-kicker">情緒分析</span>
                <strong>這篇日記主要帶有「{fusionLabelText[fusionTop1] || '尚未分類'}」</strong>
                <details>
                  <summary>查看分析細節</summary>
                  <p>文字：{describeProbs(textProbs)}</p>
                  <p>語音：{describeProbs(audioProbs)}</p>
                  <p>綜合：{describeProbs(fusionProbs)}</p>
                  {fusionTokens.length > 0 && (
                    <div className="analysis-keywords">
                      {fusionTokens.slice(0, 5).map((t, idx) => (
                        <span key={idx} className="kw-tag">
                          {typeof t?.text === 'string' ? t.text : String(t)}
                        </span>
                      ))}
                    </div>
                  )}
                </details>
              </div>
            )}
          </div>
        </section>

        <section id="journal-list" className="content-section">
          <div className="section-heading list-heading">
            <div>
              <p className="eyebrow">你的片刻</p>
              <h2>{hasActiveFilter ? `${filterTitle()}・${sortedFiltered.length} 則` : '最近日記'}</h2>
            </div>
            <Link className="trash-link" to="/trash">垃圾桶</Link>
          </div>

          <div className="journal-toolbar">
            <div className="filter-actions" role="group" aria-label="日期篩選">
              <button className={`filter-pill ${quickPreset === 'all' ? 'active' : ''}`} onClick={() => applyPreset('all')}>全部</button>
              <button className={`filter-pill ${quickPreset === 'thisMonth' ? 'active' : ''}`} onClick={() => applyPreset('thisMonth')}>本月</button>
              <button className={`filter-pill ${quickPreset === 'lastMonth' ? 'active' : ''}`} onClick={() => applyPreset('lastMonth')}>上月</button>
              <button className={`filter-pill ${quickPreset === 'custom' ? 'active' : ''}`} onClick={() => applyPreset('custom')}>自訂</button>
            </div>
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">搜尋日記</span>
              <input
                type="search"
                placeholder="搜尋日記"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </label>
          </div>

          {quickPreset === 'custom' && (
            <div className="date-range">
              <input
                className="input"
                type="date"
                value={startDate ? format(startDate, 'yyyy-MM-dd') : ''}
                onChange={(e) => setStartDate(e.target.value ? parseISO(e.target.value) : null)}
              />
              <span>至</span>
              <input
                className="input"
                type="date"
                value={endDate ? format(endDate, 'yyyy-MM-dd') : ''}
                onChange={(e) => setEndDate(e.target.value ? parseISO(e.target.value) : null)}
              />
            </div>
          )}

          <div className="list journal-list">
            {loading ? (
              <p className="empty">正在翻閱你的日記…</p>
            ) : sortedFiltered.length === 0 ? (
              <div className="empty-state"><span aria-hidden="true">✦</span><p>這裡還沒有日記</p><small>從記下一句此刻的感受開始吧。</small></div>
            ) : (
              <ul className="entries">
                {sortedFiltered.map((e) => (
                  <li key={e.id} className={`entry ${editingId === e.id ? 'editing' : ''}`}>
                    <div className="entry-main">
                      <div className="entry-meta">
                        <time className="entry-date">{formatDisplayDate(e.date)}</time>
                        {e.localPending && <span className="pending-label">待同步</span>}
                      </div>
                      {editingId === e.id ? (
                        <textarea
                          className="textarea"
                          value={editingText}
                          onChange={(ev) => setEditingText(ev.target.value)}
                          rows={4}
                        />
                      ) : (
                        <>
                          <p className="entry-summary">{summary(e.content)}</p>
                          <EmotionChip sentiment={e.sentiment} />
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
                        <button className="icon-button" title="編輯日記" aria-label="編輯日記" onClick={() => startEdit(e.id, e.content)}>✎</button>
                        <button className="icon-button danger" title="移到垃圾桶" aria-label="移到垃圾桶" onClick={() => softDelete(e.id)}>×</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="error-message">{error}</p>}
          </div>
        </section>

        <section id="insights" className="content-section insights-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">回望自己</p>
              <h2>情緒趨勢</h2>
            </div>
          </div>
          <EmotionInsights items={sortedFiltered} loading={loading} month={endDate} />
        </section>
      </main>

      <nav className="mobile-nav" aria-label="手機版導覽">
        <a href="#composer-title"><span aria-hidden="true">✎</span>今天</a>
        <a href="#journal-list"><span aria-hidden="true">☷</span>日記</a>
        <a href="#insights"><span aria-hidden="true">⌁</span>趨勢</a>
        <Link to="/settings"><span aria-hidden="true">⚙</span>設定</Link>
      </nav>

      <div className="status-stack">
        {isOffline && <div className="toast toast-error">目前為離線模式，內容將在恢復網路後同步。</div>}
        {!!syncStatus && !isOffline && <div className="toast toast-success">{syncStatus}</div>}
        {analysisToast.msg && <div className={`toast toast-${analysisToast.kind}`}>{analysisToast.msg}</div>}
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

  function removeAudio() {
    clearAudio()
    chunksRef.current = []
    onSpeechBlob?.(null, '')
    setErr('')
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
    <div className="voice-controls">
      <button className={`btn ${listening ? 'btn-danger' : 'btn-secondary'}`} onClick={listening ? stop : start}>
        {listening ? '停止語音輸入' : '開始語音輸入'}
      </button>
      {audioUrl && !listening && (
        <div className="audio-preview">
          <audio key={audioUrl} controls preload="metadata">
            <source src={audioUrl} type={audioMime || 'audio/webm;codecs=opus'} />
            您的瀏覽器無法播放錄音檔案。
          </audio>
          <button className="remove-audio-button" type="button" onClick={removeAudio}>移除錄音</button>
        </div>
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
