export type SpeechInferResp = {
  pred: string;
  probs: Record<string, number>;
};

const SPEECH_INFER_URL = import.meta.env.VITE_SPEECH_INFER_URL as string | undefined;
const SPEECH_API_KEY = import.meta.env.VITE_SPEECH_API_KEY as string | undefined;

export async function inferSpeechEmotion(file: File | Blob): Promise<SpeechInferResp> {
  if (!SPEECH_INFER_URL) {
    throw new Error('VITE_SPEECH_INFER_URL is not configured');
  }

  const form = new FormData();
  const filename = file instanceof File ? file.name : 'audio.webm';
  form.append('file', file, filename);

  const headers: Record<string, string> = {};
  if (SPEECH_API_KEY) headers['X-API-Key'] = SPEECH_API_KEY;

  const res = await fetch(SPEECH_INFER_URL, {
    method: 'POST',
    body: form,
    headers,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`speech infer failed ${res.status}: ${msg}`);
  }

  return res.json();
}
