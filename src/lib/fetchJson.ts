// Client-side JSON fetch that retries transient failures (network errors,
// timeouts, 5xx) and throws when it finally fails, so pages can show a real
// "couldn't load" state instead of an empty list that looks like missing data.
export async function fetchJson<T>(url: string, opts: { timeoutMs?: number; retries?: number } = {}): Promise<T> {
  const { timeoutMs = 15000, retries = 2 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return (await res.json()) as T;
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status < 500) break; // auth / bad request: retrying won't help
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error("Request failed");
}
