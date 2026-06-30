"use client";

import { useState } from "react";

type CronLog = {
  id: string;
  ranAt: string;
  durationMs: number | null;
  companiesScanned: number;
  newsAdded: number;
  signalsAdded: number;
  exitsDetected: number;
  fundingUpdates: number;
  discovered: number;
  candidatesExtracted: number;
  filteredByThesis: number;
  status: string;
  errorMsg: string | null;
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(ms: number | null) {
  if (!ms) return null;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

type ChipProps = { label: string; value: number; accent?: boolean };
function Chip({ label, value, accent }: ChipProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
      accent ? "bg-orange text-white" : "bg-fog text-graphite"
    }`}>
      <span className="font-bold">{value}</span>
      <span>{label}</span>
    </span>
  );
}

export function DailyDigest({ logs }: { logs: CronLog[] }) {
  const [open, setOpen] = useState(false);

  if (logs.length === 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-fog rounded-[10px] border border-chalk text-[12px] text-slate">
        <span className="w-1.5 h-1.5 rounded-full bg-chalk flex-none" />
        <span>No cron execution today</span>
      </div>
    );
  }

  const latest = logs[0];
  const running = latest.status === "running";
  const ok = latest.status === "ok";
  const dur = fmtDuration(latest.durationMs);

  return (
    <div className="bg-fog rounded-[10px] border border-chalk overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-chalk/30 transition-colors text-left"
      >
        {/* Status dot */}
        <span className={`w-1.5 h-1.5 rounded-full flex-none ${running ? "bg-amber-400 animate-pulse" : ok ? "bg-emerald-500" : "bg-red-500"}`} />

        {/* Label */}
        <span className="text-[11px] font-semibold text-carbon uppercase tracking-wide flex-none">
          Daily cron
        </span>
        <span className="text-[11px] text-slate flex-none">{fmtTime(latest.ranAt)}</span>

        <span className="text-chalk mx-1 flex-none">·</span>

        {/* Chips */}
        <div className="flex items-center gap-1.5 flex-1 flex-wrap">
          {running ? (
            <span className="text-[11px] text-amber-600 font-medium">Running now…</span>
          ) : (
            <>
              {latest.newsAdded > 0 && <Chip label="news" value={latest.newsAdded} />}
              {latest.signalsAdded > 0 && <Chip label="signals" value={latest.signalsAdded} accent />}
              {latest.discovered > 0 && <Chip label="new companies" value={latest.discovered} accent />}
              {latest.fundingUpdates > 0 && <Chip label="funding" value={latest.fundingUpdates} />}
              {latest.exitsDetected > 0 && <Chip label="exits" value={latest.exitsDetected} />}
              {latest.newsAdded === 0 && latest.signalsAdded === 0 && latest.discovered === 0 && (
                <span className="text-[11px] text-slate">No changes today</span>
              )}
            </>
          )}
        </div>

        {/* Toggle */}
        <span className="text-[11px] text-slate flex-none ml-auto">
          {open ? "Hide ↑" : "Details →"}
        </span>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="border-t border-chalk px-4 py-3 space-y-3">
          {logs.length > 1 && (
            <p className="text-[10px] text-slate">
              {logs.length} runs today · showing most recent
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-0">
            {/* Phase 1 */}
            <div>
              <p className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-1.5">
                Phase 1 — Existing companies
              </p>
              <div className="space-y-1">
                <Row label="Companies scanned"   value={latest.companiesScanned} />
                <Row label="News added"           value={latest.newsAdded} />
                <Row label="New signals"          value={latest.signalsAdded} highlight={latest.signalsAdded > 0} />
                <Row label="Funding updates"      value={latest.fundingUpdates} highlight={latest.fundingUpdates > 0} />
                <Row label="Exits detected"       value={latest.exitsDetected} highlight={latest.exitsDetected > 0} />
              </div>
            </div>

            {/* Phase 2 */}
            <div>
              <p className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-1.5">
                Phase 2 — New company discovery
              </p>
              <div className="space-y-1">
                <Row label="AI candidates extracted" value={latest.candidatesExtracted} />
                <Row label="Filtered by thesis"      value={latest.filteredByThesis} />
                <Row label="Added to radar"          value={latest.discovered} highlight={latest.discovered > 0} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 pt-1 border-t border-chalk text-[10px] text-slate">
            {dur && <span>Duration: {dur}</span>}
            <span className={`font-medium ${running ? "text-amber-600" : ok ? "text-emerald-600" : "text-red-500"}`}>
              {running ? (
                <span className="inline-flex items-center gap-1">
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="10"/></svg>
                  Running…
                </span>
              ) : ok ? "Status: OK" : `Error: ${latest.errorMsg ?? "unknown"}`}
            </span>
            {logs.length > 1 && (
              <span className="ml-auto">
                Other runs: {logs.slice(1).map((l) => fmtTime(l.ranAt)).join(", ")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-[11px] py-0.5">
      <span className="text-slate">{label}</span>
      <span className={`font-semibold ${highlight ? "text-carbon" : "text-graphite"}`}>{value}</span>
    </div>
  );
}
