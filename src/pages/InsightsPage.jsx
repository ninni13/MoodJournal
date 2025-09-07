import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'
import { db } from '../lib/firebase.js'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isAfter, subDays } from 'date-fns'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import '../App.css'

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function analyzeFallback(text) {
  const s = String(text || '')
  if (s.includes('開心')) return { label: 'positive', score: 0.9 }
  if (s.includes('累')) return { label: 'negative', score: 0.8 }
  return { label: 'neutral', score: 0.5 }
}

function avg(nums) {
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function summary(text, max = 30) {
  const s = String(text).replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

export default function InsightsPage() {
  const { currentUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [tab, setTab] = useState('line') // 'line' | 'heat'
  const [range, setRange] = useState('week') // 'week' | 'month'
  const [selectedDay, setSelectedDay] = useState(null) // 'YYYY-MM-DD'

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
        const normalized = list.map(e => ({
          id: e.id,
          date: String(e.date || todayKey()).slice(0, 10),
          content: String(e.content ?? ''),
          isDeleted: Boolean(e.isDeleted),
          sentiment: e.sentiment && typeof e.sentiment === 'object' ? e.sentiment : analyzeFallback(e.content),
        }))
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

  const lineData = useMemo(() => {
    const now = new Date()
    const days = range === 'week' ? 7 : 30
    const start = subDays(now, days - 1)
    const allDays = eachDayOfInterval({ start, end: now })

    const byKey = new Map()
    for (const it of items) {
      const d = parseISO(it.date)
      if (isAfter(start, d)) continue
      const k = it.date
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(Number(it.sentiment?.score ?? 0.5))
    }

    return allDays.map(d => {
      const k = format(d, 'yyyy-MM-dd')
      const scores = byKey.get(k) || []
      const val = avg(scores)
      return { date: k, score: val }
    })
  }, [items, range])

  const monthHeat = useMemo(() => {
    const now = new Date()
    const start = startOfMonth(now)
    const end = endOfMonth(now)
    const days = eachDayOfInterval({ start, end })
    const byKey = new Map()
    for (const it of items) {
      const k = it.date
      const dt = parseISO(k)
      if (dt < start || dt > end) continue
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(Number(it.sentiment?.score ?? 0.5))
    }
    return days.map(d => {
      const k = format(d, 'yyyy-MM-dd')
      const val = avg(byKey.get(k) || [])
      return { date: k, score: val, day: d.getDate(), dow: d.getDay() }
    })
  }, [items])

  const selectedDayItems = useMemo(() => {
    if (!selectedDay) return []
    return items.filter(i => i.date === selectedDay)
  }, [items, selectedDay])

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="title" style={{ marginBottom: 0 }}>情緒視覺化</h1>
        <div>
          <Link to="/" style={{ marginRight: '0.75rem', fontSize: 14 }}>返回日記</Link>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className={`btn ${tab === 'line' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('line')}>折線圖</button>
        <button className={`btn ${tab === 'heat' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('heat')}>熱力圖</button>
      </div>

      {tab === 'line' && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button className={`btn ${range === 'week' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => setRange('week')}>最近 7 天</button>
            <button className={`btn ${range === 'month' ? 'btn-outline' : 'btn-secondary'}`} onClick={() => setRange('month')}>最近 30 天</button>
          </div>
          {loading ? (
            <p className="empty">載入中…</p>
          ) : (
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <LineChart data={lineData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tickFormatter={(v) => format(parseISO(v), 'MM/dd')} minTickGap={20} />
                  <YAxis domain={[0, 1]} tickCount={6} />
                  <Tooltip labelFormatter={(v) => format(parseISO(v), 'yyyy/MM/dd')} formatter={(val) => [val?.toFixed?.(2), 'score']} />
                  <Line type="monotone" dataKey="score" stroke="#d36f72" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {tab === 'heat' && (
        <div style={{ marginTop: 16 }}>
          {loading ? (
            <p className="empty">載入中…</p>
          ) : (
            <>
              <div className="heatmap">
                <div className="heatmap-grid">
                  {['日','一','二','三','四','五','六'].map((d) => (
                    <div key={`h-${d}`} className="heatmap-header">{d}</div>
                  ))}
                  {monthHeat.map((d, idx) => {
                    const score = d.score
                    let cls = 'neutral'
                    if (score != null) {
                      if (score < 0.3) cls = 'neg'
                      else if (score > 0.7) cls = 'pos'
                      else cls = 'neutral'
                    }
                    const style = { gridColumnStart: idx === 0 ? (d.dow + 1) : 'auto' }
                    return (
                      <button
                        key={d.date}
                        className={`heat-cell ${cls}`}
                        style={style}
                        title={`${d.date}${score != null ? ` - 平均 ${score.toFixed(2)}` : ''}`}
                        onClick={() => setSelectedDay(d.date)}
                      >
                        <span className="heat-day">{d.day}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="heat-legend">
                  <span className="legend neg">負向</span>
                  <span className="legend neutral">中立</span>
                  <span className="legend pos">正向</span>
                </div>
              </div>

              {selectedDay && (
                <div style={{ marginTop: 12 }}>
                  <h2 className="subtitle">{format(parseISO(selectedDay), 'yyyy/MM/dd')} 的日記</h2>
                  {selectedDayItems.length === 0 ? (
                    <p className="empty">當日沒有日記</p>
                  ) : (
                    <ul className="entries">
                      {selectedDayItems.map(e => (
                        <li key={e.id} className="entry">
                          <div className="entry-main">
                            <span className="entry-summary">{summary(e.content)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

