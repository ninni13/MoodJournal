import { useState } from 'react'
import { inferSentiment } from '../lib/sentiment'

export default function SentimentTestPage() {
  const [text, setText] = useState('')
  const [res, setRes] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  async function onAnalyze() {
    setErr(null)
    setLoading(true)
    try {
      const r = await inferSentiment(text)
      setRes(r)
    } catch (e) {
      setErr(e?.message || '分析失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 12 }}>情緒分析測試</h1>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        style={{ width: '100%' }}
        placeholder="寫一段日記，按下分析"
      />
      <button onClick={onAnalyze} disabled={loading} style={{ marginTop: 8 }}>
        {loading ? '分析中...' : '分析'}
      </button>

      {err && <div style={{ color: 'red', marginTop: 8 }}>{err}</div>}

      {res && (
        <div style={{ marginTop: 12, lineHeight: 1.6 }}>
          <div>
            標籤：{res.label_zh || '—'}（{res.label_en}）
          </div>
          <div>信心：{(res.confidence * 100).toFixed(1)}%</div>
          <div>
            分布：負面 {Math.round((res.probs?.[0] || 0) * 100)}% ／ 中立 {Math.round((res.probs?.[1] || 0) * 100)}% ／ 正面 {Math.round((res.probs?.[2] || 0) * 100)}%
          </div>
        </div>
      )}
    </div>
  )
}

