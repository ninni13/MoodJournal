import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'
import { db } from '../lib/firebase.js'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import '../App.css'

export default function SettingsPage() {
  const { currentUser } = useAuth()
  const defaultTZ = 'Asia/Taipei'
  const [email, setEmail] = useState(currentUser?.email || '')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState({ msg: '', kind: 'success' })

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
    </div>
  )
}
