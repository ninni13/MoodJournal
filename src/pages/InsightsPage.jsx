import EmotionInsights from '../components/EmotionInsights.jsx'
import { analyzeEmotionLocal } from '../lib/emotions.js'
import CryptoJS from 'crypto-js'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'
import { db } from '../lib/firebase.js'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import '../App.css'

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function InsightsPage() {
  const { currentUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])

  useEffect(() => {
    async function load() {
      if (!currentUser) return
      setLoading(true)
      setError('')
      try {
        const baseCol = collection(db, 'users', currentUser.uid, 'diaries')
        const q1 = query(baseCol, orderBy('date', 'desc'))
        const snap = await getDocs(q1)
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        const normalized = list.map(e => {
          let content = String(e.content ?? '')
          if (e.contentEnc) {
            try { content = CryptoJS.AES.decrypt(e.contentEnc, currentUser.uid).toString(CryptoJS.enc.Utf8) || '（無法解密）' } catch { content = '（無法解密）' }
          }
          return ({
          id: e.id,
          date: String(e.date || todayKey()).slice(0, 10).replaceAll('/', '-'),
          content,
          isDeleted: Boolean(e.isDeleted),
          sentiment: e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : analyzeEmotionLocal(content),
        })})
        setItems(normalized.filter(e => e.isDeleted !== true))
      } catch (e) {
        console.error(e)
        setError(e?.message || '載入失敗')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentUser])

  return (
    <div className="container">
      <h1 className="title">情緒視覺化</h1>
      <Link to="/">返回日記</Link>
      {error && <p role="alert">{error}</p>}
      <EmotionInsights items={items} loading={loading} />
    </div>
  )
}
