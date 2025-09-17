import { Route, Routes, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DiaryPage from './pages/DiaryPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import TrashPage from './pages/TrashPage.jsx'
import SentimentTestPage from './pages/SentimentTestPage.jsx'
import SpeechTestPage from './pages/SpeechTestPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<ProtectedRoute />}> 
        <Route path="/" element={<DiaryPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/sentiment-test" element={<SentimentTestPage />} />
        <Route path="/speech-test" element={<SpeechTestPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
