import { useEffect, useMemo, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'
import { db } from '../lib/firebase.js'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'
import CryptoJS from 'crypto-js'
import '../App.css'

export default function SettingsPage() {
  const { currentUser } = useAuth()
  const defaultTZ = 'Asia/Taipei'
  const [email, setEmail] = useState(currentUser?.email || '')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState({ msg: '', kind: 'success' })
  const [busyExport, setBusyExport] = useState(false)
  const [busyImport, setBusyImport] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    async function load() {
      if (!currentUser) return
      setLoading(true)
      try {
        // Use subcollection 'profile' with doc id 'default'
        const ref = doc(db, 'users', currentUser.uid, 'profile', 'default')
        const snap = await getDoc(ref)
        if (snap.exists()) {
          const p = snap.data() || {}
          // Email 一律使用登入帳號，不可修改
          setEmail(currentUser.email || '')
          if (typeof p.reminderEnabled === 'boolean') setReminderEnabled(p.reminderEnabled)
        } else {
          setEmail(currentUser.email || '')
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentUser, defaultTZ])

  // 移除時區與自訂時間（固定每天 21:00 台灣時間）

  function isValidEmail(v) {
    const s = String(v || '').trim()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
  }

  async function saveProfile() {
    if (!currentUser) return
    const sEmail = String(currentUser.email || '').trim()
    if (!isValidEmail(sEmail)) {
      setToast({ msg: 'Email 格式不正確', kind: 'error' })
      setTimeout(() => setToast({ msg: '', kind: 'success' }), 2500)
      return
    }
    setSaving(true)
    try {
      const ref = doc(db, 'users', currentUser.uid, 'profile', 'default')
      await setDoc(ref, {
        email: sEmail,
        reminderEnabled: Boolean(reminderEnabled),
        updatedAt: new Date().toISOString(),
      }, { merge: true })
      setToast({ msg: '設定已儲存', kind: 'success' })
      setTimeout(() => setToast({ msg: '', kind: 'success' }), 2500)
    } catch (e) {
      console.error(e)
      setToast({ msg: `儲存失敗：${e?.code || e?.message || '未知錯誤'}`, kind: 'error' })
      setTimeout(() => setToast({ msg: '', kind: 'success' }), 3000)
    } finally {
      setSaving(false)
    }
  }

  // ===== 匯出／匯入 =====
  function normalizeDate(input) {
    try {
      const s = String(input || '').trim()
      if (!s) return ''
      const parts = s.replace(/[^0-9]+/g, '-').split('-').filter(Boolean)
      const now = new Date()
      let y, m, d
      if (parts.length === 3) {
        if (parts[0].length === 4) { y = +parts[0]; m = +parts[1]; d = +parts[2] }
        else { y = +parts[2]; if (y < 100) y = 2000 + y; m = +parts[0]; d = +parts[1] }
      } else if (parts.length === 2) {
        y = now.getFullYear(); m = +parts[0]; d = +parts[1]
      } else if (parts.length === 1 && parts[0].length >= 8) {
        const str = parts[0]; y = +str.slice(0,4); m = +str.slice(4,6); d = +str.slice(6,8)
      } else { return '' }
      const mm = String(Math.max(1, Math.min(12, m))).padStart(2, '0')
      const dd = String(Math.max(1, Math.min(31, d))).padStart(2, '0')
      return `${y}-${mm}-${dd}`
    } catch { return '' }
  }

  function encryptText(plain, key) {
    try { return CryptoJS.AES.encrypt(String(plain), String(key)).toString() } catch { return null }
  }
  function decryptText(cipher, key) {
    try {
      const bytes = CryptoJS.AES.decrypt(String(cipher), String(key))
      const txt = bytes.toString(CryptoJS.enc.Utf8)
      return txt || null
    } catch { return null }
  }

  async function readAllDiaries() {
    if (!currentUser) return []
    const base = collection(db, 'users', currentUser.uid, 'diaries')
    const snap = await getDocs(base)
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    return list.map(e => {
      let content = ''
      if (e.contentEnc) content = decryptText(e.contentEnc, currentUser.uid) || ''
      else if (typeof e.content === 'string') content = e.content
      const sentiment = e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : undefined
      return { id: e.id, date: normalizeDate(e.date) || '', content, sentiment }
    })
  }

  function download(filename, text, type='text/plain') {
    const blob = new Blob([text], { type })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  async function handleExportJSON() {
    try {
      setBusyExport(true)
      const list = await readAllDiaries()
      const ymd = new Date().toISOString().slice(0,10).replace(/-/g,'')
      download(`diary-${ymd}.json`, JSON.stringify(list, null, 2), 'application/json')
      setToast({ msg: `匯出 JSON：${list.length} 筆`, kind: 'success' })
      setTimeout(() => setToast({ msg: '', kind: 'success' }), 2500)
    } catch (e) {
      console.error(e)
      setToast({ msg: '匯出失敗', kind: 'error' })
      setTimeout(() => setToast({ msg: '', kind: 'success' }), 3000)
    } finally { setBusyExport(false) }
  }

  function toCSV(list) {
    const esc = (s) => '"' + String(s ?? '').replace(/"/g,'""') + '"'
    const header = ['id','date','content','sentiment.label','sentiment.score']
    const rows = list.map(x => [
      esc(x.id),
      esc(x.date),
      esc(x.content),
      esc(x.sentiment?.label ?? ''),
      esc(x.sentiment?.score ?? ''),
    ].join(','))
    return [header.join(','), ...rows].join('\n')
  }

  async function handleExportCSV() {
    try {
      setBusyExport(true)
      const list = await readAllDiaries()
      const csv = toCSV(list)
      const ymd = new Date().toISOString().slice(0,10).replace(/-/g,'')
      download(`diary-${ymd}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8')
      setToast({ msg: `匯出 CSV：${list.length} 筆`, kind: 'success' })
      setTimeout(() => setToast({ msg: '', kind: 'success' }), 2500)
    } catch (e) {
      console.error(e)
      setToast({ msg: '匯出失敗', kind: 'error' })
      setTimeout(() => setToast({ msg: '', kind: 'success' }), 3000)
    } finally { setBusyExport(false) }
  }

  async function handleImport(ev) {
    try {
      setBusyImport(true)
      const file = ev.target.files?.[0]
      if (!file) return
      const text = await file.text()
      let items = []
      if (/\.json$/i.test(file.name) || text.trim().startsWith('[')) {
        try { items = JSON.parse(text) } catch { items = [] }
      } else {
        const lines = text.replace(/\r/g,'').split('\n').filter(Boolean)
        const header = lines.shift()?.split(',').map(h => h.trim().replace(/^"|"$/g,'')) || []
        const idx = (k) => header.findIndex(h => h.toLowerCase() === k)
        const iId = idx('id'), iDate = idx('date'), iContent = idx('content'), iLab = idx('sentiment.label'), iSc = idx('sentiment.score')
        const parseCsvLine = (line) => {
          const out = []; let cur = '', inQ = false
          for (let i=0;i<line.length;i++) {
            const ch = line[i]
            if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++ } else { inQ = !inQ } }
            else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
            else { cur += ch }
          }
          out.push(cur); return out.map(s => s.replace(/^"|"$/g,''))
        }
        items = lines.map(l => {
          const cols = parseCsvLine(l)
          const get = (i) => i>=0 ? cols[i] : ''
          let sentiment
          if (get(iLab) || get(iSc)) sentiment = { label: get(iLab)||'', score: Number(get(iSc)||'') }
          return { id: get(iId), date: get(iDate), content: get(iContent), sentiment }
        })
      }
      let added = 0, skipped = 0
      for (const e of items) {
        const id = String(e.id || '').trim(); if (!id) { skipped++; continue }
        const date = normalizeDate(e.date) || new Date().toISOString().slice(0,10)
        const content = String(e.content || '')
        const sentiment = e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : undefined
        const ref = doc(db, 'users', currentUser.uid, 'diaries', id)
        const exists = await getDoc(ref)
        if (exists.exists()) { skipped++; continue }
        const contentEnc = CryptoJS.AES.encrypt(content, currentUser.uid).toString()
        await setDoc(ref, { id, date, contentEnc, sentiment, isDeleted: false, updatedAt: new Date().toISOString() })
        added++
      }
      setToast({ msg: `匯入完成：新增 ${added} 筆，略過 ${skipped} 筆`, kind: 'success' })
      setTimeout(() => setToast({ msg: '', kind: 'success' }), 3000)
      ev.target.value = ''
    } catch (e) {
      console.error(e)
      setToast({ msg: '匯入失敗', kind: 'error' })
      setTimeout(() => setToast({ msg: '', kind: 'success' }), 3000)
    } finally { setBusyImport(false) }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="title" style={{ marginBottom: 0 }}>設定</h1>
        <div>
          <Link to="/" style={{ marginRight: '0.75rem', fontSize: 14 }}>返回</Link>
        </div>
      </div>

      <div className="list" style={{ marginTop: '1rem' }}>
        <h2 className="subtitle">提醒設定</h2>
        <div className="filters" style={{ marginTop: 8 }}>
          <label className="label">Email（使用登入帳號，不可修改）</label>
          <input
            className="input input-full"
            type="email"
            placeholder="name@example.com"
            value={email}
            readOnly
            disabled
          />

          <p style={{ color: '#666', fontSize: 14 }}>
            提醒寄送時間：每天 21:00（台灣時間）。開啟提醒即可生效。
          </p>

          <div className="filters-row" style={{ marginTop: 4 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
                disabled={!isValidEmail(currentUser?.email || '') || loading || saving}
              />
              啟用提醒（僅當日未寫會寄信）
            </label>
          </div>

          <div className="actions">
            <button
              className="btn btn-primary"
              onClick={saveProfile}
              disabled={!isValidEmail(currentUser?.email || '') || loading || saving}
            >
              {saving ? '儲存中…' : '儲存設定'}
            </button>
          </div>

          {toast.msg && (
            <div className={`toast toast-${toast.kind}`}>
              {toast.msg}
            </div>
          )}
        </div>
      </div>

      <div className="list" style={{ marginTop: '1.5rem' }}>
        <h2 className="subtitle">匯出／匯入</h2>
        <div className="filters" style={{ marginTop: 8 }}>
          <div className="filters-row" style={{ alignItems: 'center' }}>
            <button className="btn btn-secondary" disabled={busyExport || loading} onClick={handleExportJSON}>
              {busyExport ? '匯出中…' : '匯出 JSON'}
            </button>
            <button className="btn btn-secondary" disabled={busyExport || loading} onClick={handleExportCSV}>
              {busyExport ? '匯出中…' : '匯出 CSV'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              onChange={handleImport}
              disabled={busyImport || loading}
              style={{ display: 'none' }}
            />
            <button
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={busyImport || loading}
            >
              {busyImport ? '匯入中…' : '匯入檔案'}
            </button>
          </div>
          <div style={{ marginTop: 6, color: '#888', fontSize: 12 }}>
            支援 JSON/CSV；欄位：<code>id, date, content, sentiment</code>。同 id 會自動略過。
          </div>
        </div>
      </div>
    </div>
  )
}
