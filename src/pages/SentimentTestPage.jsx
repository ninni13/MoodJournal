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
            <strong>標籤：</strong>
            {res.label === 'pos' && '😊 正向'}
            {res.label === 'neu' && '😐 中立'}
            {res.label === 'neg' && '☹️ 負向'}
            （{res.label}）
          </div>
          <div><strong>信心：</strong>{(res.confidence * 100).toFixed(1)}%</div>
          <div>
            <strong>概率分布：</strong>
            負面 {Math.round((res.probs?.neg || 0) * 100)}% ／ 
            中立 {Math.round((res.probs?.neu || 0) * 100)}% ／ 
            正面 {Math.round((res.probs?.pos || 0) * 100)}%
          </div>
          <div><strong>模型：</strong>{res.model} v{res.version}</div>
          <div><strong>閾值：</strong>{res.threshold}</div>
          
          {res.top_tokens && res.top_tokens.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>關鍵詞貢獻：</strong>
              <div style={{ marginTop: 4, fontSize: '14px' }}>
                {res.top_tokens.slice(0, 5).map((token, i) => (
                  <span 
                    key={i} 
                    style={{ 
                      display: 'inline-block',
                      margin: '2px 4px 2px 0',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: token.label === 'neg' ? '#fee2e2' : 
                                     token.label === 'pos' ? '#dcfce7' : '#f3f4f6',
                      color: token.label === 'neg' ? '#991b1b' : 
                             token.label === 'pos' ? '#065f46' : '#374151',
                      fontSize: '12px'
                    }}
                    title={`貢獻度: ${(token.contrib * 100).toFixed(1)}%`}
                  >
                    {token.text} ({(token.contrib * 100).toFixed(1)}%)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

