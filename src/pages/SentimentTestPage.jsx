import { useState } from 'react'
import { Link } from 'react-router-dom'
import { inferSentiment } from '../lib/sentiment'
import '../App.css'

export default function SentimentTestPage() {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onAnalyze() {
    setError('')
    setResult(null)
    const payload = text.trim()
    if (!payload) {
      setError('請先輸入內容')
      return
    }
    setLoading(true)
    try {
      const resp = await inferSentiment(payload)
      setResult(resp)
    } catch (e) {
      setError(e?.message || '分析失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Sentiment Test</h1>
        <Link to="/" style={{ fontSize: 14 }}>Back to journal</Link>
      </div>

      <p style={{ color: '#555', lineHeight: 1.6 }}>
        這個頁面會把文字內容送去情緒推論 API（{import.meta.env.VITE_INFER_URL || '未設定'}）。
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        style={{ width: '100%', marginTop: 8 }}
        placeholder="貼上一段文字試試看。"
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary" onClick={onAnalyze} disabled={loading}>
          {loading ? '分析中…' : '開始分析'}
        </button>
        <button className="btn btn-outline" onClick={() => { setText(''); setResult(null); setError('') }} disabled={loading && !text}>
          清空
        </button>
      </div>

      {error && (
        <div style={{ color: 'crimson', marginTop: 12 }}>{error}</div>
      )}

      {result && (
        <div style={{ marginTop: 16, lineHeight: 1.6 }}>
          <div><strong>Label (en):</strong> {result.label_en}</div>
          <div><strong>Label (zh):</strong> {result.label_zh || '—'}</div>
          <div><strong>Confidence:</strong> {(result.confidence * 100).toFixed(1)}%</div>
          <div><strong>Threshold:</strong> {result.threshold}</div>
          <div><strong>Model:</strong> {result.model}</div>
          {Array.isArray(result.probs) && result.probs.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Probabilities</strong>
              <ul style={{ paddingLeft: 20, marginTop: 4 }}>
                {result.probs.map((p, idx) => (
                  <li key={idx}>{(p * 100).toFixed(2)}%</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
