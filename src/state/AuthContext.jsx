import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { auth, firebaseEnabled } from '../lib/firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!firebaseEnabled || !auth) {
      // Firebase not configured; treat as logged out
      setLoading(false)
      return
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  const value = useMemo(() => ({ currentUser, loading }), [currentUser, loading])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
