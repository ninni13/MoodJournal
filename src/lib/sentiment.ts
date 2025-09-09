export type InferResp = {
  label_en: "negative" | "neutral" | "positive" | "uncertain";
  label_zh: string;
  confidence: number;
  probs: number[];
  threshold: number;
  model: string;
};

const INFER_URL = import.meta.env.VITE_INFER_URL as string;
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

export async function inferSentiment(text: string): Promise<InferResp> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY; // ← 這裡帶金鑰

  const r = await fetch(INFER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(`infer failed ${r.status}: ${msg}`);
  }
  return r.json();
}
