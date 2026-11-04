"use client";
// Semantic search across every company document, with an AI answer that cites its sources.
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { startJob } from "@/lib/backgroundJobs";

type Status = {
  files: number; indexed: number; waiting: number; errors: number; pendingPassages: number; available: boolean;
  job: { id: string; message: string | null; progress: number } | null;
  companies: { id: string; name: string; files: number }[];
};
type Hit = { id: string; companyId: string; companyName: string; fileId: string; filename: string; locator: string | null; text: string; score: number };

const EXAMPLES = ["What's the revenue breakdown by segment?", "Customer concentration and top clients", "EBITDA margin evolution", "Management team and founders' background"];

export default function SearchPage() {
  return <Suspense fallback={null}><SearchInner /></Suspense>;
}

function SearchInner() {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [companyId, setCompanyId] = useState(params.get("company") ?? "");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [withAnswer, setWithAnswer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerNote, setAnswerNote] = useState<string | null>(null);
  const [asked, setAsked] = useState("");
  const autoStarted = useRef(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/search/status").catch(() => null);
    if (res?.ok) setStatus(await res.json());
  }, []);

  // Keep the index status fresh while indexing runs.
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!status?.job) return;
    const t = setInterval(loadStatus, 5000);
    return () => clearInterval(t);
  }, [status?.job, loadStatus]);

  const startIndexing = useCallback(async () => {
    try { await startJob("index_documents", {}); } catch { /* shown via status */ }
    setTimeout(loadStatus, 800);
  }, [loadStatus]);

  // Documents waiting and nobody indexing them: start once per visit.
  useEffect(() => {
    if (!status || autoStarted.current || !status.available) return;
    if (!status.job && (status.waiting > 0 || status.pendingPassages > 0)) {
      autoStarted.current = true;
      startIndexing();
    }
  }, [status, startIndexing]);

  async function run(q = query) {
    const text = q.trim();
    if (!text) return;
    setQuery(text); setBusy(true); setErr(null); setAnswer(null); setAnswerNote(null); setAsked(text);
    try {
      const res = await fetch("/api/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, companyId: companyId || undefined, answer: withAnswer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setHits(data.hits); setAnswer(data.answer); setAnswerNote(data.answerError ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
      setHits(null);
    } finally {
      setBusy(false);
    }
  }

  const scopeName = status?.companies.find(c => c.id === companyId)?.name;
  const ctl = "text-[13px] bg-paper border border-chalk rounded-[8px] px-3 py-2 text-carbon focus:outline-none focus:border-carbon";

  return (
    <div>
      <Topbar title="Search" subtitle="Ask across every deck, model and report uploaded to PANDO" />
      <div className="p-6 space-y-4 max-w-[980px]">
        <Card>
          <form onSubmit={e => { e.preventDefault(); run(); }} className="space-y-3">
            <div className="flex gap-2">
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                placeholder="e.g. What did management say about pricing in 2024?" className={`${ctl} flex-1`} />
              <Button type="submit" variant="fill" loading={busy} disabled={!query.trim()}>Search</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-graphite">
              <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-[12px] bg-fog border border-chalk rounded-[6px] px-2 py-1">
                <option value="">All companies</option>
                {status?.companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.files})</option>)}
              </select>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={withAnswer} onChange={() => setWithAnswer(v => !v)} /> Answer with AI (cites sources)</label>
              <IndexBadge status={status} onIndex={startIndexing} />
            </div>
          </form>
        </Card>

        {err && <Card><p className="text-[13px] text-red-600">{err}</p></Card>}

        {hits === null && !err && !busy && (
          <Card>
            <p className="text-[12px] text-slate mb-2">Try asking</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map(x => (
                <button key={x} onClick={() => run(x)} className="text-[12px] px-3 py-1.5 rounded-full border border-chalk text-graphite hover:border-carbon hover:text-carbon">{x}</button>
              ))}
            </div>
          </Card>
        )}

        {busy && <Card><p className="text-[13px] text-slate">{withAnswer ? "Searching the documents and writing an answer…" : "Searching…"}</p></Card>}

        {!busy && hits && (
          <>
            {(answer || answerNote) && (
              <Card>
                <p className="text-[10px] uppercase tracking-wide text-slate mb-1.5">Answer{scopeName ? ` · ${scopeName}` : ""}</p>
                {answer ? <AnswerText text={answer} /> : <p className="text-[12px] text-slate">{answerNote}</p>}
              </Card>
            )}
            <div>
              <p className="text-[12px] text-slate mb-2">
                {hits.length ? `${hits.length} passage${hits.length === 1 ? "" : "s"} for “${asked}”${scopeName ? ` in ${scopeName}` : ""}` : `Nothing found for “${asked}”. Documents still being indexed won't show up yet.`}
              </p>
              <div className="space-y-2">
                {hits.map((h, i) => (
                  <Card key={h.id} id={`src-${i + 1}`} className="scroll-mt-20">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-carbon truncate">
                          <span className="text-slate font-normal mr-1.5">[{i + 1}]</span>{h.filename}
                          {h.locator && <span className="font-normal text-graphite"> · {h.locator}</span>}
                        </p>
                        <Link href={`/empresa/${h.companyId}`} className="text-[11px] text-forest hover:underline">{h.companyName}</Link>
                      </div>
                      <span className="text-[10px] text-slate shrink-0" title="Similarity">{Math.round(h.score * 100)}%</span>
                    </div>
                    <p className="text-[12px] text-graphite leading-relaxed whitespace-pre-line line-clamp-6">{h.text}</p>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IndexBadge({ status, onIndex }: { status: Status | null; onIndex: () => void }) {
  if (!status) return null;
  if (!status.available) return <span className="ml-auto text-[11px] text-red-600">Search isn&apos;t configured (VOYAGE_API_KEY missing)</span>;
  const label = `${status.indexed} of ${status.files} document${status.files === 1 ? "" : "s"} searchable`;
  return (
    <span className="ml-auto text-[11px] text-slate flex items-center gap-2">
      {label}
      {status.job ? (
        <span className="text-graphite">· {status.job.message ?? "Indexing…"}</span>
      ) : status.waiting > 0 || status.pendingPassages > 0 ? (
        <button type="button" onClick={onIndex} className="font-medium text-forest hover:underline">Index now</button>
      ) : null}
      {status.errors > 0 && <span className="text-red-600">· {status.errors} couldn&apos;t be read</span>}
    </span>
  );
}

// Light formatting: paragraphs, **bold**, bullet lines, and [n] links to the passages.
function AnswerText({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const m = /^\[(\d+)\]$/.exec(part);
    if (m) return <a key={i} href={`#src-${m[1]}`} className="text-forest font-medium text-[10px] align-super hover:underline">[{m[1]}]</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
  return (
    <div className="text-[13px] text-carbon leading-relaxed space-y-2">
      {text.split(/\n{2,}/).map((para, i) => (
        <div key={i}>
          {para.split("\n").map((line, j) => {
            const bullet = /^\s*[-•*]\s+/.test(line);
            const body = line.replace(/^\s*[-•*]\s+/, "").replace(/^#+\s*/, "");
            return <p key={j} className={bullet ? "pl-4 relative before:content-['•'] before:absolute before:left-1 before:text-slate" : ""}>{inline(body)}</p>;
          })}
        </div>
      ))}
    </div>
  );
}
