// Browser helpers for server background jobs (see src/lib/jobs.ts).
export type ClientJob = {
  id: string; type: string; status: "queued" | "running" | "done" | "error" | "cancelled";
  title: string; companyId: string | null; progress: number; message: string | null;
  error: string | null; result: unknown; createdAt: string; finishedAt: string | null;
};

export const JOBS_CHANGED_EVENT = "pando:jobs-changed";

/** Starts a job on the server and returns it right away (it keeps running if the page closes). */
export async function startJob(type: string, input: unknown): Promise<ClientJob> {
  const res = await fetch("/api/jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, input }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Could not start the task (HTTP ${res.status})`);
  // Let the jobs tray pick it up immediately.
  window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
  return data as ClientJob;
}

/**
 * Polls a job until it finishes, reporting each update. Resolves with the
 * final job; rejects with its error message. A network blip doesn't fail it.
 */
export async function waitForJob(id: string, onUpdate?: (job: ClientJob) => void, opts: { signal?: AbortSignal; intervalMs?: number } = {}): Promise<ClientJob> {
  const interval = opts.intervalMs ?? 2000;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let job: ClientJob | null = null;
    try {
      const res = await fetch(`/api/jobs/${id}`, { signal: AbortSignal.timeout(10000) });
      if (res.status === 404) throw new Error("The task no longer exists");
      if (res.ok) job = await res.json() as ClientJob;
    } catch (err) {
      if (err instanceof Error && err.message === "The task no longer exists") throw err;
      // network blip or timeout: try again on the next tick
    }
    if (job) {
      onUpdate?.(job);
      if (job.status === "done") return job;
      if (job.status === "error") throw new Error(job.error ?? "The task failed");
      if (job.status === "cancelled") throw new DOMException("Cancelled", "AbortError");
    }
    await new Promise(r => setTimeout(r, interval));
  }
}

export async function cancelJob(id: string): Promise<void> {
  await fetch(`/api/jobs/${id}/cancel`, { method: "POST" }).catch(() => {});
  window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
}
