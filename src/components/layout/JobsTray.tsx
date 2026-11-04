"use client";
// Top-bar tray of the user's background jobs (extractions, deck builds, comps
// sync): live progress, a toast when one finishes, and its result.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cancelJob, JOBS_CHANGED_EVENT, type ClientJob } from "@/lib/backgroundJobs";

const ACTIVE = new Set(["queued", "running"]);

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hasFile(j: ClientJob) {
  return j.status === "done" && !!(j.result as { filename?: string } | null)?.filename;
}

function JobActions({ job, onDone }: { job: ClientJob; onDone?: () => void }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      {hasFile(job) && (
        <a href={`/api/jobs/${job.id}/download`} onClick={onDone}
          className="text-[11px] font-medium text-white bg-forest rounded-[6px] px-2 py-0.5 hover:opacity-85">Download</a>
      )}
      {job.companyId && job.status === "done" && (
        <Link href={job.type === "sync_document_comps" ? "/comparables" : `/empresa/${job.companyId}`} onClick={onDone}
          className="text-[11px] font-medium text-forest hover:underline">Open</Link>
      )}
      {ACTIVE.has(job.status) && (
        <button onClick={() => cancelJob(job.id)} className="text-[11px] text-slate hover:text-red-600">Cancel</button>
      )}
    </div>
  );
}

export function JobsTray() {
  const [jobs, setJobs] = useState<ClientJob[]>([]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<ClientJob[]>([]);
  const seen = useRef<Map<string, string>>(new Map());
  const first = useRef(true);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs", { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const list = await res.json() as ClientJob[];
      // Toast jobs that finished since the last poll (not on the first load).
      if (!first.current) {
        const finished = list.filter(j => !ACTIVE.has(j.status) && j.status !== "cancelled" && ACTIVE.has(seen.current.get(j.id) ?? ""));
        if (finished.length) setToasts(t => [...t, ...finished]);
      }
      first.current = false;
      seen.current = new Map(list.map(j => [j.id, j.status]));
      setJobs(list);
    } catch { /* keep the last list */ }
  }, []);

  const running = jobs.filter(j => ACTIVE.has(j.status)).length;

  useEffect(() => {
    load();
    const id = setInterval(load, running ? 3000 : 30000);
    const onChange = () => load();
    window.addEventListener(JOBS_CHANGED_EVENT, onChange);
    return () => { clearInterval(id); window.removeEventListener(JOBS_CHANGED_EVENT, onChange); };
  }, [load, running]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => setToasts(ts => ts.slice(1)), 9000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <>
      <div ref={ref} className="relative">
        <button onClick={() => setOpen(v => !v)} title="Background tasks"
          className={`relative w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-white/10 transition-colors ${open ? "bg-white/15 text-white" : "text-white/70 hover:text-white"}`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            className={running ? "animate-spin" : ""} style={running ? { animationDuration: "2.4s" } : undefined}>
            <path d="M21 12a9 9 0 1 1-6.2-8.56" />
          </svg>
          {running > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-white text-forest text-[9px] font-bold rounded-full flex items-center justify-center">{running}</span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-10 w-[360px] bg-paper border border-chalk rounded-[12px] shadow-xl z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-chalk">
              <p className="text-[13px] font-semibold text-carbon">Background tasks</p>
              <p className="text-[10px] text-slate">They keep running if you leave the page or close the tab.</p>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-chalk">
              {jobs.length === 0 ? (
                <p className="text-[12px] text-slate text-center py-8">No tasks yet</p>
              ) : jobs.map(j => (
                <div key={j.id} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] font-medium text-carbon leading-snug">{j.title}</p>
                    <span className={`shrink-0 text-[9px] font-semibold uppercase rounded-full px-1.5 py-0.5 ${
                      j.status === "done" ? "bg-emerald-50 text-emerald-700"
                      : j.status === "error" ? "bg-red-50 text-red-600"
                      : j.status === "cancelled" ? "bg-fog text-slate"
                      : "bg-forest/10 text-forest"}`}>{j.status === "queued" ? "starting" : j.status}</span>
                  </div>
                  {ACTIVE.has(j.status) && (
                    <div className="mt-1.5 h-1 bg-fog rounded-full overflow-hidden">
                      <div className="h-1 bg-forest rounded-full transition-all" style={{ width: `${Math.max(4, j.progress)}%` }} />
                    </div>
                  )}
                  <p className={`text-[10px] mt-1 ${j.status === "error" ? "text-red-600" : "text-slate"}`}>
                    {j.status === "error" ? j.error : j.message} · {ago(j.finishedAt ?? j.createdAt)}
                  </p>
                  <JobActions job={j} onDone={() => setOpen(false)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Toasts for tasks that just finished */}
      <div className="fixed bottom-4 right-4 z-[60] space-y-2">
        {toasts.slice(0, 3).map(j => (
          <div key={j.id} className={`w-[320px] bg-paper border rounded-[10px] shadow-xl px-4 py-3 ${j.status === "error" ? "border-red-200" : "border-chalk"}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12px] font-semibold text-carbon">{j.status === "error" ? "Task failed" : "Task finished"}</p>
              <button onClick={() => setToasts(ts => ts.filter(t => t.id !== j.id))} className="text-slate hover:text-carbon text-[12px]">×</button>
            </div>
            <p className="text-[11px] text-graphite">{j.title}</p>
            {j.status === "error" && <p className="text-[10px] text-red-600 mt-0.5">{j.error}</p>}
            <JobActions job={j} onDone={() => setToasts(ts => ts.filter(t => t.id !== j.id))} />
          </div>
        ))}
      </div>
    </>
  );
}
