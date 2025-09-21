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
  const base = import.meta.env.VITE_GATEWAY_BASE;
  if (!base) throw new Error('Missing VITE_GATEWAY_BASE');

  const fd = new FormData();
  fd.append('text', text ?? '');
  fd.append('alpha', String(alpha));
  if (audioBlob instanceof Blob && audioBlob.size > 0) {
    fd.append('file', audioBlob, 'note.wav');
  }

  const res = await fetch(`${base.replace(/\/$/, '')}/predict-fusion`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) throw new Error(`fusion failed: ${res.status}`);
  return res.json();
}
