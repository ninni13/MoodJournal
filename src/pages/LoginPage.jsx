import { useEffect, useState, useCallback } from 'react'
import '../App.css'
import './login.css'
import { useLocation, useNavigate, Link } from 'react-router-dom'
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

  const handleGoogleLogin = useCallback(async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault()
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
  }, [location.state, navigate])

  return (
    <div className="login-screen" role="document">
      <div className="login-bg" aria-hidden="true" />
      <main className="login-main" role="main">
        <section className="login-card" role="region" aria-labelledby="login-title" aria-describedby="login-desc">
          <header className="login-header">
            <h1 id="login-title" className="login-title">情緒日記</h1>
            <p id="login-desc" className="login-desc">請先登入以使用你的日記</p>
          </header>

          <form className="login-actions" onSubmit={handleGoogleLogin}>
            <button
              type="submit"
              className="btn btn-google"
              aria-label="使用 Google 登入"
              disabled={busy || !firebaseEnabled}
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  <span>登入中…</span>
                </>
              ) : (
                <>
                  <GoogleIcon />
                  <span>使用 Google 登入</span>
                </>
              )}
            </button>
          </form>

          {!firebaseEnabled && (
            <p className="login-hint" aria-live="polite">
              尚未設定 Firebase，請建立 <code>.env.local</code> 並填入 Vite 變數，然後重啟 dev server。
            </p>
          )}
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <p className="login-legal">
            使用本服務即表示你同意 
            <Link to="/privacy">隱私權政策</Link> 與 
            <Link to="/terms">服務條款</Link>。
          </p>
        </section>
      </main>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg
      className="icon"
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.569 32.328 29.229 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.869 6.053 29.7 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.651-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.817C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.869 6.053 29.7 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.197l-6.196-5.238C29.112 35.091 26.671 36 24 36c-5.206 0-9.532-3.352-11.096-7.995l-6.53 5.027C9.666 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-1.294 3.225-3.904 5.811-7.094 7.036l.006-.004 6.196 5.238C32.231 41.205 36.5 44 42 44c.896 0 1.776-.069 2.639-.202C45.389 41.67 46 37.93 46 34c0-1.341-.138-2.651-.389-3.917z"/>
    </svg>
  )
}
