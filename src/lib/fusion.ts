export type Probs = { pos: number; neu: number; neg: number };

type FusionResp = {
  text_pred: Probs;
  audio_pred: Probs;
  fusion_pred: Probs;
  text_top1: string;
  audio_top1: string;
  fusion_top1: string;
  alpha: number;
  labels: string[];
};

export async function predictFusion(text: string, audioBlob?: Blob, alpha = 0.5): Promise<FusionResp> {
  const envBase = import.meta.env.VITE_GATEWAY_BASE;
  if (!envBase) throw new Error('Missing VITE_GATEWAY_BASE');
  const base = envBase.replace(/\/$/, '');

  const fd = new FormData();
  fd.append('text', text ?? '');
  fd.append('alpha', String(alpha));
  if (audioBlob && audioBlob.size > 0) {
    fd.append('file', audioBlob, 'note.webm');
  }

  const res = await fetch(`${base}/predict-fusion`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) throw new Error(`fusion failed: ${res.status}`);
  return res.json();
}
