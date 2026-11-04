// Background jobs: a row in "Job" tracks a long task that keeps running on the
// server after the request that started it has returned (via next/server
// `after`, which Vercel keeps alive up to the route's maxDuration). The browser
// polls the row for progress, so closing the tab doesn't lose the work.
import { db, jobs } from "@/lib/db";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { randomUUID } from "crypto";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type JobRow = typeof jobs.$inferSelect;

export interface JobContext {
  jobId: string;
  userId: string;
  /** Report progress (0–100) and a short message shown in the jobs tray. */
  progress(message: string, pct?: number): Promise<void>;
  /** True once the user cancelled; handlers check it between steps. */
  isCancelled(): Promise<boolean>;
}

export class JobCancelled extends Error {
  constructor() { super("Cancelled"); }
}

// A running job writes a heartbeat; one silent for this long was killed by the
// platform's time limit (or a crash) and is reported as interrupted.
const STALE_MS = 90_000;
const HEARTBEAT_MS = 15_000;

const now = () => new Date().toISOString();

export async function createJob(opts: {
  type: string; userId: string; title: string; input: unknown; companyId?: string | null;
}): Promise<JobRow> {
  const row = {
    id: randomUUID(),
    type: opts.type,
    status: "queued",
    userId: opts.userId,
    companyId: opts.companyId ?? null,
    title: opts.title.slice(0, 200),
    progress: 0,
    message: "Queued",
    input: JSON.stringify(opts.input ?? {}),
    createdAt: now(),
  };
  await db.insert(jobs).values(row);
  return (await db.query.jobs.findFirst({ where: eq(jobs.id, row.id) }))!;
}

/** Runs a queued job to completion, recording progress, result or error. */
export async function executeJob(
  id: string,
  handler: (input: unknown, ctx: JobContext) => Promise<unknown>,
): Promise<void> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
  if (!job || job.status !== "queued") return;
  await db.update(jobs).set({ status: "running", startedAt: now(), heartbeatAt: now(), message: "Starting…" }).where(eq(jobs.id, id));

  const beat = setInterval(() => {
    db.update(jobs).set({ heartbeatAt: now() }).where(eq(jobs.id, id)).catch(() => {});
  }, HEARTBEAT_MS);

  let lastCancelCheck = 0;
  let cancelled = false;
  const ctx: JobContext = {
    jobId: id,
    userId: job.userId,
    async progress(message, pct) {
      const set: Partial<JobRow> = { message: message.slice(0, 300), heartbeatAt: now() };
      if (pct != null) set.progress = Math.max(0, Math.min(100, Math.round(pct)));
      await db.update(jobs).set(set).where(eq(jobs.id, id)).catch(() => {});
    },
    async isCancelled() {
      if (cancelled) return true;
      if (Date.now() - lastCancelCheck < 4000) return false;
      lastCancelCheck = Date.now();
      const row = await db.query.jobs.findFirst({ where: eq(jobs.id, id), columns: { status: true } }).catch(() => null);
      cancelled = row?.status === "cancelled";
      return cancelled;
    },
  };

  try {
    const result = await handler(JSON.parse(job.input || "{}"), ctx);
    if (await ctx.isCancelled()) return;
    await db.update(jobs).set({
      status: "done", progress: 100, message: "Done", result: JSON.stringify(result ?? null), finishedAt: now(),
    }).where(eq(jobs.id, id));
  } catch (err) {
    if (err instanceof JobCancelled || cancelled) {
      await db.update(jobs).set({ status: "cancelled", message: "Cancelled", finishedAt: now() }).where(eq(jobs.id, id)).catch(() => {});
      return;
    }
    console.error(`[job ${job.type} ${id}]`, err);
    await db.update(jobs).set({
      status: "error", error: (err instanceof Error ? err.message : String(err)).slice(0, 2000), finishedAt: now(),
    }).where(eq(jobs.id, id)).catch(() => {});
  } finally {
    clearInterval(beat);
  }
}

/** Marks running jobs whose heartbeat stopped as interrupted. */
export async function markStaleJobs(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const interrupted = {
    status: "error",
    error: "Interrupted: the task ran past the server's time limit or the server restarted. Please try again.",
    finishedAt: now(),
  };
  await db.update(jobs).set(interrupted)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "running"), lt(jobs.heartbeatAt, cutoff)));
  // Queued jobs that never started (the server stopped before picking them up)
  await db.update(jobs).set(interrupted)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "queued"), lt(jobs.createdAt, cutoff)));
}

export async function listJobs(userId: string, limit = 20): Promise<JobRow[]> {
  await markStaleJobs(userId).catch(() => {});
  return db.query.jobs.findMany({ where: eq(jobs.userId, userId), orderBy: [desc(jobs.createdAt)], limit });
}

/** Client-safe view of a job (no raw input; result without server-only keys). */
export function publicJob(j: JobRow) {
  let result: unknown = null;
  try { result = j.result ? JSON.parse(j.result) : null; } catch { /* keep null */ }
  if (result && typeof result === "object") {
    const { blobUrl: _blob, ...rest } = result as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
    result = rest;
  }
  return {
    id: j.id, type: j.type, status: j.status as JobStatus, title: j.title, companyId: j.companyId,
    progress: j.progress, message: j.message, error: j.error, result,
    createdAt: j.createdAt, finishedAt: j.finishedAt,
  };
}
