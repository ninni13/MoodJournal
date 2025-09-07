import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { signInWithGoogle, firebaseEnabled } from '../lib/firebase.js'
import { useAuth } from '../state/AuthContext.jsx'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // If already logged in, redirect to intended page or home
  useEffect(() => {
    if (currentUser) {
      const to = location.state?.from?.pathname || '/'
      navigate(to, { replace: true })
    }
  }, [currentUser, location.state, navigate])

  async function handleGoogleLogin() {
    setError('')
    setBusy(true)
    try {
      await signInWithGoogle()
      const to = location.state?.from?.pathname || '/'
      navigate(to, { replace: true })
    } catch (e) {
      console.error(e)
      setError(e?.message || '登入失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container" style={{ textAlign: 'center' }}>
      <h1 className="title">情緒日記</h1>
      <p style={{ marginBottom: '1rem', color: '#666' }}>請先登入以使用你的日記</p>
      <button className="btn btn-primary" onClick={handleGoogleLogin} disabled={busy || !firebaseEnabled}>
        {busy ? '登入中…' : '使用 Google 登入'}
      </button>
      {!firebaseEnabled && (
        <p style={{ marginTop: '1rem', color: '#666', fontSize: 14 }}>
          尚未設定 Firebase，請建立 <code>.env.local</code> 並填入 Vite 變數，然後重啟 dev server。
        </p>
      )}
      {error && <p style={{ color: 'crimson', marginTop: '1rem' }}>{error}</p>}
    </div>
  )
}
