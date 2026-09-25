export type EmotionLabel =
  | 'Anger'
  | 'Disgust'
  | 'Fear'
  | 'Happy'
  | 'Neutral'
  | 'Sad'
  | 'Surprise'

export type EmotionProbs = Record<EmotionLabel, number>

export type FusionResp = {
  mode: 'text_only' | 'multimodal'
  labels: EmotionLabel[]

  text_pred: EmotionProbs
  audio_pred: EmotionProbs | null
  fusion_pred: EmotionProbs

  text_top1: EmotionLabel
  audio_top1: EmotionLabel | null
  fusion_top1: EmotionLabel

  confidence: number
}

export async function predictFusion(
  text: string,
  audioBlob?: Blob
): Promise<FusionResp> {

  const envBase = import.meta.env.VITE_GATEWAY_BASE

  if (!envBase) {
    throw new Error('Missing VITE_GATEWAY_BASE')
  }

  const base = envBase.replace(/\/$/, '')

  const fd = new FormData()

  fd.append('text', text ?? '')

  if (audioBlob && audioBlob.size > 0) {
    fd.append(
      'file',
      audioBlob,
      'note.webm'
    )
  }

  const res = await fetch(
    `${base}/predict-fusion`,
    {
      method: 'POST',
      body: fd,
    }
  )

  if (!res.ok) {
    const msg = await res
      .text()
      .catch(() => res.statusText)

    throw new Error(
      `fusion failed: ${res.status} ${msg}`
    )
  }

  return res.json()
}
