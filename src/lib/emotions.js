export const EMOTION_META = {
  Anger: { emoji: '😠', text: '生氣', color: '#c2410c' },
  Disgust: { emoji: '🤢', text: '厭惡', color: '#4d7c0f' },
  Fear: { emoji: '😨', text: '害怕', color: '#7e22ce' },
  Happy: { emoji: '😊', text: '開心', color: '#047857' },
  Neutral: { emoji: '😐', text: '中立', color: '#64748b' },
  Sad: { emoji: '😢', text: '難過', color: '#1d4ed8' },
  Surprise: { emoji: '😮', text: '驚訝', color: '#a16207' },
}
export function emotionKey(sentiment) {
  return Object.keys(EMOTION_META).find(key => key.toLowerCase() === String(sentiment?.label || '').toLowerCase()) || null
}
export function emotionDays(items, dates) {
  const rows = new Map(dates.map(date => [date, { date, total: 0, unknown: 0, ...Object.fromEntries(Object.keys(EMOTION_META).map(k => [k, 0])) }]))
  for (const item of items) {
    const row = rows.get(String(item.date).slice(0, 10).replaceAll('/', '-'))
    if (!row) continue
    const key = emotionKey(item.sentiment)
    row[key || 'unknown']++
    row.total++
  }
  return [...rows.values()]
}
export function analyzeEmotionLocal(text) {
  const words = {
    Anger: ['生氣', '憤怒', '火大', '煩'], Disgust: ['噁心', '厭惡', '討厭'],
    Fear: ['害怕', '恐懼', '擔心', '焦慮', '壓力'], Happy: ['開心', '快樂', '愉悅', '幸福', '讚', '好吃', '好玩'],
    Sad: ['難過', '傷心', '痛苦', '失望', '累'], Surprise: ['驚訝', '驚喜', '意外', '沒想到'],
  }
  const ranked = Object.entries(words).map(([label, tokens]) => ({ label, hits: tokens.filter(w => String(text || '').includes(w)).length })).sort((a, b) => b.hits - a.hits)
  return { label: ranked[0].hits > 0 ? ranked[0].label : 'Neutral', source: 'local-fallback' }
}
