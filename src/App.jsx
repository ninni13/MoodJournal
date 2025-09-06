import { Route, Routes, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DiaryPage from './pages/DiaryPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<ProtectedRoute />}> 
        <Route path="/" element={<DiaryPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

