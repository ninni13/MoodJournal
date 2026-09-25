import { useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, subDays, parseISO } from 'date-fns'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { EMOTION_META, emotionDays } from '../lib/emotions.js'
import EmotionChip from './EmotionChip.jsx'

const series = { ...EMOTION_META, unknown: { emoji: '—', text: '舊分類／未分類', color: '#94a3b8' } }
export default function EmotionInsights({ items, loading, month }) {
  const [tab, setTab] = useState('bars')
  const [range, setRange] = useState(7)
  const [selectedDay, setSelectedDay] = useState(null)
  const now = new Date()
  const base = month || now
  const dates = (start, end) => eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'))
  const rows = emotionDays(items, dates(subDays(now, range - 1), now))
  const calendar = emotionDays(items, dates(startOfMonth(base), endOfMonth(base)))
  const visible = tab === 'bars' ? rows : calendar
  const keys = Object.keys(series).filter(k => k !== 'unknown' || visible.some(row => row.unknown))
  const describe = row => row.total ? keys.filter(k => row[k]).map(k => `${series[k].text} ${row[k]} 篇`).join('、') : '沒有日記'
  return <div>
    <div className="emotion-controls">
      <button className={`btn ${tab === 'bars' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('bars')}>情緒分布</button>
      <button className={`btn ${tab === 'calendar' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('calendar')}>情緒月曆</button>
    </div>
    <p className="emotion-note">每篇日記依主要情緒計數；顏色代表情緒類別，不代表好壞或強度。</p>
    {loading ? <p className="empty">載入中…</p> : <>
      {tab === 'bars' ? <>
        <div className="emotion-controls">{[7, 30].map(n => <button key={n} className={`btn ${range === n ? 'btn-outline' : 'btn-secondary'}`} onClick={() => setRange(n)}>最近 {n} 天</button>)}</div>
        {!rows.some(row => row.total) ? <p className="empty">這段期間沒有日記</p> : <div style={{ width: '100%', height: 320 }} role="img" aria-label={`最近 ${range} 天每日情緒篇數堆疊長條圖`}>
          <ResponsiveContainer><BarChart data={rows} accessibilityLayer margin={{ top: 16, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis dataKey="date" tickFormatter={v => v.slice(5).replace('-', '/')} minTickGap={20} stroke="var(--chart-axis)" />
            <YAxis allowDecimals={false} stroke="var(--chart-axis)" />
            <Tooltip formatter={(value, name) => [`${value} 篇`, name]} contentStyle={{ background: 'var(--bg, white)', color: 'var(--text, #333)' }} />
            {keys.map(key => <Bar key={key} dataKey={key} name={series[key].text} stackId="emotions" fill={series[key].color} maxBarSize={40} />)}
          </BarChart></ResponsiveContainer>
        </div>}
      </> : <>
        <h3>{format(base, 'yyyy/MM')} 情緒月曆</h3>
        <div className="heatmap-grid">{['日', '一', '二', '三', '四', '五', '六'].map(d => <div key={d} className="heatmap-header">{d}</div>)}
          {calendar.map((row, i) => <button key={row.date} className={`heat-cell emotion-cell ${row.total ? '' : 'emotion-empty'}`} style={{ gridColumnStart: i === 0 ? parseISO(row.date).getDay() + 1 : undefined }} title={`${row.date}：${describe(row)}`} aria-label={`${row.date}：${describe(row)}`} aria-pressed={selectedDay === row.date} onClick={() => setSelectedDay(row.date)}>
            <span>{Number(row.date.slice(-2))}</span>
            <span className="emotion-segments">{keys.filter(k => row[k]).map(k => <span key={k} style={{ flex: row[k], background: series[k].color }} />)}</span>
            <span className="emotion-day-count">{row.total ? `${row.total} 篇` : '—'}</span>
          </button>)}
        </div>
        {selectedDay && <div style={{ marginTop: 16 }}><h3>{selectedDay} 的日記</h3>
          {items.filter(e => e.date === selectedDay).length === 0 && <p className="empty">當日沒有日記</p>}
          <ul className="entries">{items.filter(e => e.date === selectedDay).map(e => <li className="entry" key={e.id}><div className="entry-main" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}><span style={{ whiteSpace: 'pre-wrap' }}>{e.content}</span><EmotionChip sentiment={e.sentiment} />{e.sentiment?.topTokens?.length > 0 && <span className="kw-tags">{e.sentiment.topTokens.slice(0, 5).map((t, i) => <span className="kw-tag" key={i}>{t.text}</span>)}</span>}</div></li>)}</ul>
        </div>}
      </>}
      <div className="emotion-legend">{keys.map(k => <span key={k}><i style={{ background: series[k].color }} />{series[k].emoji} {series[k].text}</span>)}</div>
      {visible.some(row => row.unknown > 0) && <p className="emotion-note">舊正向／負向資料未推測成七類情緒；編輯並儲存日記可重新分析。</p>}
    </>}
  </div>
}
