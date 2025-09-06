import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'

export default function ProtectedRoute() {
  const { currentUser, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div style={{ padding: '2rem' }}>載入中…</div>
  }

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

