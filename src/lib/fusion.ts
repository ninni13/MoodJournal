// src/api/fusion.ts
export type Probs = { pos: number; neu: number; neg: number };

export async function predictFusion(
  text: string,
  audioBlob: Blob,
  alpha = 0.5
): Promise<{
  text_pred: Probs;
  audio_pred: Probs;
  fusion_pred: Probs;
  text_top1: string;
  audio_top1: string;
  fusion_top1: string;
  alpha: number;
  labels: string[];
}> {
  const base = import.meta.env.VITE_GATEWAY_URL;
  if (!base) throw new Error('Missing VITE_GATEWAY_URL');

  const fd = new FormData();
  fd.append('text', text ?? '');
  fd.append('alpha', String(alpha));
  fd.append('file', audioBlob, 'note.wav');

  const res = await fetch(`${base.replace(/\/$/, '')}/predict-fusion`, {
    method: 'POST',
    body: fd, // 切記：不要手動設 Content-Type
    credentials: 'omit',
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`fusion failed: ${res.status} ${msg}`);
  }
  return res.json();
}
