// Text embeddings for document search, via Voyage AI (voyage-4, 1024 dims).
//
// Rate limits: an account without a payment method gets 3 requests and 10K
// tokens per minute. Calls are paced to stay inside VOYAGE_RPM / VOYAGE_TPM
// (defaults match that free tier; raise them once a card is on file), and a
// 429 is retried after the wait the API asks for.
//
// In local development without VOYAGE_API_KEY a deterministic word-hashing
// embedding stands in, so search can be exercised offline (rough quality).

export const EMBED_DIMS = 1024;
const MODEL = process.env.VOYAGE_MODEL ?? "voyage-4";
const RPM = Number(process.env.VOYAGE_RPM ?? 3);
const TPM = Number(process.env.VOYAGE_TPM ?? 10_000);

/** Conservative token estimate (Voyage counts ~1 token per 3.5–4 chars). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.2);

/** Largest batch (in estimated tokens) one request may carry under the TPM limit. */
export const MAX_BATCH_TOKENS = Math.max(500, Math.floor(TPM * 0.8));

export function embeddingsAvailable() {
  return !!process.env.VOYAGE_API_KEY || process.env.NODE_ENV !== "production";
}

// Pacing within this server instance.
let nextSlot = 0;
async function waitForSlot(tokens: number) {
  const gapMs = Math.max(60_000 / RPM, (tokens / TPM) * 60_000);
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gapMs;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}

/** Milliseconds until the next request may be sent (0 = now). */
export const msUntilNextSlot = () => Math.max(0, nextSlot - Date.now());

/** Voyage kept answering "too many requests": the caller should stop and try again later. */
export class EmbedRateLimited extends Error {}

export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (!texts.length) return [];
  const key = process.env.VOYAGE_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("VOYAGE_API_KEY is not configured");
    return texts.map(localEmbedding);
  }
  const tokens = texts.reduce((n, t) => n + estimateTokens(t), 0);
  for (let attempt = 0; ; attempt++) {
    // Queries are tiny and interactive: don't queue them behind indexing pacing.
    if (inputType === "document") await waitForSlot(tokens);
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType, output_dimension: EMBED_DIMS }),
    });
    if (res.ok) {
      const j = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      return j.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
    }
    const body = await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 21_000 * (attempt + 1);
      nextSlot = Date.now() + wait;
      if (inputType === "query") await new Promise(r => setTimeout(r, Math.min(wait, 15_000)));
      continue;
    }
    if (res.status === 429) throw new EmbedRateLimited(`Voyage rate limit reached: ${body.slice(0, 200)}`);
    throw new Error(`Voyage embeddings failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

// ── Local stand-in (development only) ───────────────────────────────────────
function localEmbedding(text: string): number[] {
  const v = new Array<number>(EMBED_DIMS).fill(0);
  const words = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{2,}/g) ?? [];
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[Math.abs(h) % EMBED_DIMS] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / norm);
}
