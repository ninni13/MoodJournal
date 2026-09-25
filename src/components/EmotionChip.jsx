import { EMOTION_META, emotionKey } from '../lib/emotions.js'

export default function EmotionChip({ sentiment }) {
  const key = emotionKey(sentiment)
  const legacy = { positive: '舊分類：正向', negative: '舊分類：負向' }
  const meta = EMOTION_META[key] || { emoji: '—', text: legacy[sentiment?.label] || '尚未分類', color: '#64748b' }
  const confidence = key && sentiment?.source !== 'local-fallback' && Number.isFinite(sentiment?.confidence) && sentiment.confidence >= 0 && sentiment.confidence <= 1 ? sentiment.confidence : null
  return <span className="chip-wrap"><span className="chip" style={{ background: meta.color, borderColor: meta.color, color: '#fff' }} title={`${meta.text}${confidence !== null ? `（信心 ${(confidence * 100).toFixed(1)}%）` : ''}${sentiment?.source === 'local-fallback' ? '（本地估計）' : ''}`}>
    {meta.emoji} {meta.text}{confidence !== null && <span style={{ marginLeft: 4, fontSize: 11 }}>{Math.round(confidence * 100)}%</span>}
  </span></span>
}
