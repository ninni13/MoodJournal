import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'
import { db } from '../lib/firebase.js'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import '../App.css'

export default function SettingsPage() {
  const { currentUser } = useAuth()
  const defaultTZ = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei' } catch { return 'Asia/Taipei' }
  }, [])
  const [email, setEmail] = useState(currentUser?.email || '')
  const [timezone, setTimezone] = useState(defaultTZ)
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderTime, setReminderTime] = useState('21:00') // HH:mm，每天寄信時間（地區時區）
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

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
          if (typeof p.timezone === 'string') setTimezone(p.timezone)
          if (typeof p.reminderEnabled === 'boolean') setReminderEnabled(p.reminderEnabled)
          if (typeof p.reminderTime === 'string') setReminderTime(p.reminderTime)
        } else {
          setTimezone(defaultTZ)
          setEmail(currentUser.email || '')
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentUser, defaultTZ])

  // Build timezone list (browser supported list with fallback)
  const tzList = useMemo(() => {
    let list = []
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        list = Intl.supportedValuesOf('timeZone') || []
      }
    } catch {}
    if (!Array.isArray(list) || list.length === 0) {
      list = [
        'Asia/Taipei', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Bangkok', 'Asia/Kuala_Lumpur', 'Asia/Jakarta',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
        'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Toronto', 'America/Sao_Paulo',
        'Australia/Sydney', 'Pacific/Auckland',
      ]
    }
    if (!list.includes(defaultTZ)) list = [defaultTZ, ...list]
    return Array.from(new Set(list))
  }, [defaultTZ])

  function isValidEmail(v) {
    const s = String(v || '').trim()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
  }

  async function saveProfile() {
    if (!currentUser) return
    const sEmail = String(currentUser.email || '').trim()
    if (!isValidEmail(sEmail)) {
      setToast('Email 格式不正確')
      setTimeout(() => setToast(''), 2000)
      return
    }
    setSaving(true)
    try {
      const ref = doc(db, 'users', currentUser.uid, 'profile', 'default')
      await setDoc(ref, {
        email: sEmail,
        timezone: String(timezone || defaultTZ),
        reminderEnabled: Boolean(reminderEnabled),
        reminderTime: String(reminderTime || '21:00'),
        updatedAt: new Date().toISOString(),
      }, { merge: true })
      setToast('設定已儲存')
      setTimeout(() => setToast(''), 2000)
    } catch (e) {
      console.error(e)
      setToast(`儲存失敗：${e?.code || e?.message || '未知錯誤'}`)
      setTimeout(() => setToast(''), 2000)
    } finally {
      setSaving(false)
    }
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

          <div className="filters-row">
            <div className="field field-lg">
              <label className="label">時區</label>
              <select
                className="input"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={loading || saving}
              >
                {tzList.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
            <div className="field field-sm">
              <label className="label">每天寄信時間（當地時區）</label>
              <input
                className="input"
                type="time"
                step={60}
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                disabled={loading || saving}
              />
            </div>
          </div>

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

          {toast && <div className="toast">{toast}</div>}
        </div>
      </div>
    </div>
  )
}
