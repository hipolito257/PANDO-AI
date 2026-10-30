"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fmtM } from "@/lib/utils";
import type { ExtractionResult, ExtractedField, ExtractedFinancial } from "@/lib/companyFileExtract";

type Applied = { at: string; fields: number; years: number; founders: number; comps: number };

type CompanyFile = {
  id: string; companyId: string; filename: string; ext: string; sizeBytes: number;
  uploadedByName: string | null; createdAt: string | null;
  extractionStatus: "none" | "done" | "error"; extraction: (ExtractionResult & { applied?: Applied }) | null;
  extractionError: string | null; extractionCostUsd: number | null; extractedAt: string | null;
};

type Snapshot = { year: number; revenueUsd: number | null; ebitdaUsd: number | null; employees: number | null };

type Props = {
  companyId: string;
  current: Record<string, string | number | null>;
  snapshots: Snapshot[];
  founderNames: string[];
};

const CHUNK_SIZE = 3 * 1024 * 1024; // under Vercel's 4.5 MB request limit
const ACCEPT = ".pdf,.pptx,.xlsx,.docx,.csv,.txt,.png,.jpg,.jpeg,.webp,.gif";

const FIELD_LABELS: Record<string, string> = {
  description: "Description", sector: "Sector", subsector: "Subsector", country: "Country", city: "City",
  stage: "Stage", fundingStage: "Funding stage", website: "Website", linkedinUrl: "LinkedIn",
  revenueUsd: "Revenue", revenueGrowth: "Revenue growth", ebitdaUsd: "EBITDA", ebitdaMargin: "EBITDA margin",
  employees: "Employees", employeeGrowth: "Headcount growth", totalFunding: "Total funding",
  lastFundingAmt: "Last round", lastFundingDate: "Last round date",
};
const MONEY = new Set(["revenueUsd", "ebitdaUsd", "totalFunding", "lastFundingAmt"]);
const PCT = new Set(["revenueGrowth", "ebitdaMargin", "employeeGrowth"]);

function fmtValue(field: string, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (MONEY.has(field) && Number.isFinite(n)) return fmtM(n);
  if (PCT.has(field) && Number.isFinite(n)) return `${n.toFixed(1)}%`;
  if (field === "employees" && Number.isFinite(n)) return Math.round(n).toLocaleString("en-US");
  return String(v);
}

function sameValue(field: string, a: string | number | null | undefined, b: string): boolean {
  if (a === null || a === undefined || a === "") return false;
  if (MONEY.has(field) || PCT.has(field) || field === "employees") {
    const x = Number(a), y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= Math.max(1, Math.abs(y) * 0.005);
  }
  return String(a).trim().toLowerCase() === b.trim().toLowerCase();
}

function fmtSize(b: number) {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

function fmtWhen(d: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const EXT_COLORS: Record<string, string> = {
  pdf: "bg-red-50 text-red-700 border-red-200", pptx: "bg-orange-50 text-orange-700 border-orange-200",
  xlsx: "bg-emerald-50 text-emerald-700 border-emerald-200", docx: "bg-blue-50 text-blue-700 border-blue-200",
};

export function CompanyFilesPanel({ companyId, current, snapshots, founderNames }: Props) {
  const router = useRouter();
  const [files, setFiles]       = useState<CompanyFile[]>([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState<{ name: string; done: number; total: number } | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/files`);
      if (res.ok) setFiles(await res.json());
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  async function uploadOne(f: File) {
    const uploadId = crypto.randomUUID();
    const total = Math.ceil(f.size / CHUNK_SIZE) || 1;
    const chunkUrls: string[] = [];
    setUploading({ name: f.name, done: 0, total });
    for (let i = 0; i < total; i++) {
      const fd = new FormData();
      fd.append("chunk", f.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      fd.append("uploadId", uploadId);
      fd.append("chunkIndex", String(i));
      fd.append("filename", f.name);
      const res = await fetch("/api/documents/translate/upload-chunk", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Upload of ${f.name} failed (part ${i + 1}/${total})`);
      chunkUrls.push((await res.json()).chunkUrl);
      setUploading({ name: f.name, done: i + 1, total });
    }
    const res = await fetch(`/api/companies/${companyId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunkUrls, filename: f.name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Upload of ${f.name} failed`);
    setFiles(prev => [data, ...prev]);
  }

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    try {
      for (const f of Array.from(list)) await uploadOne(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function extract(file: CompanyFile) {
    setError(null);
    setExtracting(file.id);
    try {
      const res = await fetch(`/api/companies/${companyId}/files/${file.id}/extract`, { method: "POST" });
      const data = await res.json().catch(() => ({ error: `Extraction failed (HTTP ${res.status})` }));
      if (!res.ok) throw new Error(data.error ?? "Extraction failed");
      await load();
      setReviewId(file.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
      await load();
    } finally {
      setExtracting(null);
    }
  }

  async function remove(file: CompanyFile) {
    if (!confirm(`Delete "${file.filename}"?\n\nIt will no longer feed documents, comparables suggestions or the chat. Data already applied to the profile stays (edit it there if needed). This can't be undone.`)) return;
    const res = await fetch(`/api/companies/${companyId}/files/${file.id}`, { method: "DELETE" });
    if (res.ok) setFiles(prev => prev.filter(f => f.id !== file.id));
  }

  const reviewing = files.find(f => f.id === reviewId && f.extraction);

  return (
    <div>
      {/* Upload area */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`flex items-center justify-between gap-4 rounded-[8px] border-2 border-dashed px-4 py-3 transition-colors ${dragOver ? "border-carbon bg-fog" : "border-chalk"}`}
      >
        <p className="text-[12px] text-slate">
          {uploading
            ? `Uploading ${uploading.name}… ${Math.round((uploading.done / uploading.total) * 100)}%`
            : "Drop decks, financial models or reports here: PDF, PowerPoint, Excel, Word or images."}
        </p>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={e => handleFiles(e.target.files)} />
        <Button variant="outline" size="sm" loading={!!uploading} onClick={() => inputRef.current?.click()}>Upload files</Button>
      </div>

      {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
      {notice && <p className="text-[12px] text-emerald-700 mt-2">{notice}</p>}

      {/* File list */}
      <div className="mt-3 divide-y divide-chalk">
        {loading ? (
          <p className="text-[12px] text-slate py-3">Loading files…</p>
        ) : files.length === 0 ? (
          <p className="text-[12px] text-slate py-3 text-center">No files yet</p>
        ) : files.map(f => (
          <div key={f.id} className="flex items-center gap-3 py-2.5">
            <span className={`text-[9px] font-bold uppercase border rounded px-1.5 py-0.5 w-11 text-center shrink-0 ${EXT_COLORS[f.ext] ?? "bg-fog text-graphite border-chalk"}`}>{f.ext}</span>
            <div className="flex-1 min-w-0">
              <a href={`/api/companies/${companyId}/files/${f.id}`} className="text-[13px] font-medium text-carbon hover:underline truncate block">{f.filename}</a>
              <p className="text-[10px] text-slate">
                {fmtSize(f.sizeBytes)} · {f.uploadedByName ?? "—"} · {fmtWhen(f.createdAt)}
                {f.extractionStatus === "done" && f.extractionCostUsd != null && <> · analysed for ${f.extractionCostUsd.toFixed(2)}</>}
              </p>
              <p className="text-[10px] mt-0.5">
                {f.extraction?.applied
                  ? <span className="text-emerald-700">Applied {fmtWhen(f.extraction.applied.at)}: {[
                      f.extraction.applied.fields && `${f.extraction.applied.fields} profile field(s)`,
                      f.extraction.applied.years && `${f.extraction.applied.years} year(s) of financials`,
                      f.extraction.applied.founders && `${f.extraction.applied.founders} people`,
                      f.extraction.applied.comps && `${f.extraction.applied.comps} comparable(s)`,
                    ].filter(Boolean).join(" · ") || "reviewed, nothing new"}</span>
                  : f.extractionStatus === "done"
                    ? <span className="text-amber-700">Extracted, not applied yet</span>
                    : <span className="text-slate">Feeds generated documents and the chat</span>}
              </p>
              {f.extractionStatus === "error" && extracting !== f.id && (
                <p className="text-[10px] text-red-600 mt-0.5">{f.extractionError}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {extracting === f.id ? (
                <span className="text-[11px] text-slate flex items-center gap-1.5">
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="10"/></svg>
                  Reading document… long decks take 1–3 min
                </span>
              ) : (
                <>
                  {f.extractionStatus === "done" && (
                    <Button variant="fill" size="sm" onClick={() => setReviewId(f.id)}>Review data</Button>
                  )}
                  <Button variant={f.extractionStatus === "done" ? "ghost" : "outline"} size="sm"
                    disabled={!!extracting} onClick={() => extract(f)}>
                    {f.extractionStatus === "done" ? "Re-extract" : f.extractionStatus === "error" ? "Retry" : "Extract data"}
                  </Button>
                  <button onClick={() => remove(f)} title="Delete file"
                    className="text-slate hover:text-red-600 p-1.5 rounded hover:bg-fog transition-colors">
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5.5 4V2.5h3V4M3.5 4l.7 8h5.6l.7-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {reviewing && (
        <ReviewModal
          companyId={companyId}
          file={reviewing}
          current={current}
          snapshots={snapshots}
          founderNames={founderNames}
          onClose={() => setReviewId(null)}
          onApplied={(msg) => { setReviewId(null); setNotice(msg); load(); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ── Review & apply ───────────────────────────────────────────────────────────

function ReviewModal({ companyId, file, current, snapshots, founderNames, onClose, onApplied }: {
  companyId: string; file: CompanyFile; current: Props["current"]; snapshots: Snapshot[]; founderNames: string[];
  onClose: () => void; onApplied: (message: string) => void;
}) {
  const x = file.extraction!;
  const existingFounders = new Set(founderNames.map(n => n.trim().toLowerCase()));
  const snapByYear = new Map(snapshots.map(s => [s.year, s]));

  // Exchange rates (units per USD) for every non-USD currency in the extraction,
  // prefilled with the model's suggestion; the user confirms or edits them.
  const currencies = [...new Set([
    ...x.fields.filter(f => MONEY.has(f.field)).map(f => f.currency),
    ...x.financials.filter(f => f.revenue !== null || f.ebitda !== null).map(f => f.currency),
  ].map(c => (c || "USD").toUpperCase()).filter(c => c !== "USD"))];
  const suggested = Object.fromEntries((x.fxRates ?? []).map(r => [r.currency.toUpperCase(), r]));
  const [fx, setFx] = useState<Record<string, string>>(() =>
    Object.fromEntries(currencies.map(c => [c, suggested[c] ? String(suggested[c].unitsPerUsd) : ""])));

  const toUsd = (amount: number | null, currency: string): number | null => {
    if (amount === null || !Number.isFinite(amount)) return null;
    const cur = (currency || "USD").toUpperCase();
    if (cur === "USD") return Math.round(amount);
    const rate = Number(fx[cur]);
    return rate > 0 ? Math.round(amount / rate) : null;
  };
  // The value to save for a profile field (money converted to USD); null if it can't be converted yet.
  const fieldValue = (f: ExtractedField): string | null => {
    if (!MONEY.has(f.field)) return f.value;
    const usd = toUsd(Number(f.value), f.currency);
    return usd === null ? null : String(usd);
  };
  const finUsd = (f: ExtractedFinancial) => ({ revenueUsd: toUsd(f.revenue, f.currency), ebitdaUsd: toUsd(f.ebitda, f.currency) });
  const finBlocked = (f: ExtractedFinancial) => {
    const u = finUsd(f);
    return (f.revenue !== null && u.revenueUsd === null) || (f.ebitda !== null && u.ebitdaUsd === null);
  };

  // Defaults: fill empty profile fields; changing an existing value is opt-in.
  const [fieldSel, setFieldSel] = useState<boolean[]>(() => x.fields.map(f => {
    const v = fieldValue(f);
    const empty = current[f.field] === null || current[f.field] === undefined || current[f.field] === "";
    return empty && !(v !== null && sameValue(f.field, current[f.field], v));
  }));
  // Defaults: actual years only; forecasts/budgets/LTM would be saved as that year's figures.
  const [finSel, setFinSel] = useState<boolean[]>(() => x.financials.map(f => f.period === "actual"));
  const [founderSel, setFounderSel] = useState<boolean[]>(() => x.founders.map(f => !existingFounders.has(f.name.trim().toLowerCase())));
  const comps = x.comparables ?? [];
  const [compSel, setCompSel] = useState<boolean[]>(() => comps.map(() => true));
  const [saveNote, setSaveNote] = useState(true);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (arr: boolean[], set: (v: boolean[]) => void, i: number) => set(arr.map((v, j) => (j === i ? !v : v)));
  const fieldOn = (i: number) => {
    const v = fieldValue(x.fields[i]);
    return fieldSel[i] && v !== null && !sameValue(x.fields[i].field, current[x.fields[i].field], v);
  };
  const finOn = (i: number) => finSel[i] && !finBlocked(x.financials[i]);
  const missingFx = currencies.filter(c => !(Number(fx[c]) > 0));
  const count = x.fields.filter((_, i) => fieldOn(i)).length + x.financials.filter((_, i) => finOn(i)).length
    + founderSel.filter(Boolean).length + compSel.filter(Boolean).length + (saveNote ? 1 : 0);

  async function apply() {
    setApplying(true);
    setErr(null);
    try {
      const fields = Object.fromEntries(x.fields.flatMap((f, i) => (fieldOn(i) ? [[f.field, fieldValue(f)!]] : [])));
      const financials = x.financials.flatMap((f, i) => (finOn(i) ? [{ year: f.year, ...finUsd(f), employees: f.employees }] : []));
      const founders = x.founders.filter((_, i) => founderSel[i]);
      const comparables = comps.filter((_, i) => compSel[i]);
      const res = await fetch(`/api/companies/${companyId}/apply-extraction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, financials, founders, comparables, fileId: file.id, fileName: file.filename }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error ?? "Failed to apply changes");

      if (saveNote) {
        const facts = x.keyFacts.map(k => `• ${k.label}: ${k.value} (${k.source})`).join("\n");
        await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, content: `From "${file.filename}" (${x.documentType}):\n${x.summary}${facts ? `\n\nKey facts:\n${facts}` : ""}` }),
        });
      }
      const compMsg = comparables.length
        ? ` ${result.compsAdded?.length ?? 0} comparable(s) added to Comparables${result.compsUnresolved?.length ? ` (not found on the stock market: ${result.compsUnresolved.join(", ")})` : ""}.`
        : "";
      onApplied(`Applied data from "${file.filename}".${compMsg}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to apply changes");
      setApplying(false);
    }
  }

  const th = "text-left text-[10px] font-semibold text-slate uppercase tracking-wide py-2 px-2";
  const td = "text-[12px] text-carbon py-2 px-2 align-top";

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto p-6" onClick={onClose}>
      <div className="bg-paper rounded-[12px] shadow-xl w-full max-w-[1000px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-chalk">
          <div className="min-w-0">
            <p className="text-[11px] text-slate uppercase tracking-wide">{x.documentType}</p>
            <h3 className="text-[15px] font-semibold text-carbon truncate">{file.filename}</h3>
            {x.usage && (
              <p className="text-[10px] text-slate mt-0.5">
                {x.usage.inputTokens.toLocaleString("en-US")} input + {x.usage.outputTokens.toLocaleString("en-US")} output tokens · ${x.usage.costUsd.toFixed(2)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate hover:text-carbon p-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-5">
          <p className="text-[13px] text-graphite leading-relaxed">{x.summary}</p>

          {(x.warnings.length > 0 || (x.preprocessingNotes ?? []).some(n => /skipped|only the first/i.test(n))) && (
            <div className="bg-[#fffbeb] border border-amber-200 rounded-[8px] px-3 py-2 space-y-1">
              {[...x.warnings, ...(x.preprocessingNotes ?? []).filter(n => /skipped|only the first/i.test(n))].map((w, i) => (
                <p key={i} className="text-[12px] text-amber-800">⚠ {w}</p>
              ))}
            </div>
          )}

          {/* Exchange rates */}
          {currencies.length > 0 && (
            <section className="bg-fog rounded-[8px] px-3 py-2.5">
              <h4 className="text-[13px] font-semibold text-carbon">Exchange rate</h4>
              <p className="text-[11px] text-slate mb-2">The document reports in {currencies.join(", ")}. Profile amounts are saved in USD, so confirm the rate used to convert.</p>
              <div className="flex flex-wrap gap-4">
                {currencies.map(c => (
                  <label key={c} className="flex items-center gap-2 text-[12px] text-carbon">
                    <span className="font-medium">{c} per 1 USD</span>
                    <input type="number" step="any" min="0" value={fx[c] ?? ""} onChange={e => setFx({ ...fx, [c]: e.target.value })}
                      className="w-24 px-2 py-1 text-[12px] bg-paper border border-chalk rounded-[6px] focus:outline-none focus:border-carbon" />
                    {suggested[c]?.basis && <span className="text-[10px] text-slate">suggested: {suggested[c].basis}</span>}
                  </label>
                ))}
              </div>
              {missingFx.length > 0 && <p className="text-[11px] text-amber-700 mt-1.5">Enter a rate for {missingFx.join(", ")} to apply money amounts in that currency.</p>}
            </section>
          )}

          {/* Profile fields */}
          <section>
            <h4 className="text-[13px] font-semibold text-carbon mb-1">Profile fields</h4>
            {x.fields.length === 0 ? <p className="text-[12px] text-slate">No profile fields found in this document.</p> : (
              <table className="w-full border-collapse">
                <thead><tr className="border-b border-chalk">
                  <th className={`${th} w-8`} /><th className={th}>Field</th><th className={th}>Current</th><th className={th}>From document</th><th className={th}>Source</th>
                </tr></thead>
                <tbody>
                  {x.fields.map((f: ExtractedField, i) => {
                    const v = fieldValue(f);
                    const same = v !== null && sameValue(f.field, current[f.field], v);
                    const foreign = MONEY.has(f.field) && (f.currency || "USD").toUpperCase() !== "USD";
                    return (
                      <tr key={i} className="border-b border-chalk last:border-0">
                        <td className={td}><input type="checkbox" disabled={same || v === null} checked={fieldOn(i)} onChange={() => toggle(fieldSel, setFieldSel, i)} /></td>
                        <td className={`${td} font-medium whitespace-nowrap`}>{FIELD_LABELS[f.field] ?? f.field}</td>
                        <td className={`${td} text-slate`}>{fmtValue(f.field, current[f.field])}</td>
                        <td className={td}>
                          <span className={same ? "text-slate" : "font-semibold"}>{v === null ? "needs FX rate" : fmtValue(f.field, v)}</span>
                          {same && <span className="text-[10px] text-slate"> (same)</span>}
                          {foreign && <span className="text-[10px] text-slate"> from {f.currency} {fmtM(Number(f.value)).replace("$", "")}</span>}
                          {f.originalText && f.originalText !== f.value && <p className="text-[10px] text-slate">“{f.originalText}”</p>}
                        </td>
                        <td className={`${td} text-[11px] text-graphite`}>{f.source}{f.note && <p className="text-[10px] text-slate">{f.note}</p>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* Financial history */}
          <section>
            <h4 className="text-[13px] font-semibold text-carbon mb-1">Financial history</h4>
            {x.financials.length === 0 ? <p className="text-[12px] text-slate">No yearly financials found.</p> : (
              <>
                <table className="w-full border-collapse">
                  <thead><tr className="border-b border-chalk">
                    <th className={`${th} w-8`} /><th className={th}>Year</th><th className={th}>Type</th><th className={th}>Revenue</th><th className={th}>EBITDA</th><th className={th}>Employees</th><th className={th}>Currently saved</th><th className={th}>Source</th>
                  </tr></thead>
                  <tbody>
                    {x.financials.map((f: ExtractedFinancial, i) => {
                      const saved = snapByYear.get(f.year);
                      const usd = finUsd(f);
                      const foreign = (f.currency || "USD").toUpperCase() !== "USD";
                      const money = (orig: number | null, conv: number | null) => (
                        <>
                          {orig !== null && conv === null ? <span className="text-amber-700">needs FX rate</span> : fmtM(conv)}
                          {foreign && orig !== null && <span className="block text-[10px] text-slate">{f.currency} {fmtM(orig).replace("$", "")}</span>}
                        </>
                      );
                      return (
                        <tr key={i} className="border-b border-chalk last:border-0">
                          <td className={td}><input type="checkbox" disabled={finBlocked(f)} checked={finOn(i)} onChange={() => toggle(finSel, setFinSel, i)} /></td>
                          <td className={`${td} font-medium`}>{f.year}</td>
                          <td className={td}>
                            <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${f.period === "actual" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{f.period}</span>
                          </td>
                          <td className={td}>{money(f.revenue, usd.revenueUsd)}</td>
                          <td className={td}>{money(f.ebitda, usd.ebitdaUsd)}</td>
                          <td className={td}>{f.employees?.toLocaleString("en-US") ?? "—"}</td>
                          <td className={`${td} text-[11px] text-slate`}>{saved ? `${fmtM(saved.revenueUsd)} / ${fmtM(saved.ebitdaUsd)}` : "—"}</td>
                          <td className={`${td} text-[11px] text-graphite`}>
                            {f.source}
                            {f.note && <p className="text-[10px] text-slate">{f.note}</p>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[10px] text-slate mt-1">Forecast, budget and LTM rows are unchecked by default: if you apply them, they are saved as that year&apos;s figures.</p>
              </>
            )}
          </section>

          {/* Founders */}
          {x.founders.length > 0 && (
            <section>
              <h4 className="text-[13px] font-semibold text-carbon mb-1">Founders & management</h4>
              <div className="space-y-1.5">
                {x.founders.map((f, i) => {
                  const exists = existingFounders.has(f.name.trim().toLowerCase());
                  return (
                    <label key={i} className={`flex items-start gap-2 text-[12px] ${exists ? "text-slate" : "text-carbon"}`}>
                      <input type="checkbox" className="mt-0.5" disabled={exists} checked={founderSel[i] && !exists} onChange={() => toggle(founderSel, setFounderSel, i)} />
                      <span><strong>{f.name}</strong>{f.title && `, ${f.title}`}{exists && " (already on profile)"}{f.bio && <span className="block text-[11px] text-graphite">{f.bio}</span>}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* Public comparables */}
          {comps.length > 0 && (
            <section>
              <h4 className="text-[13px] font-semibold text-carbon mb-1">Public comparables</h4>
              <p className="text-[10px] text-slate mb-1.5">Checked companies are added to this company&apos;s set in Comparables (live market data loads when you refresh there). Figures below are as stated in the document.</p>
              <div className="space-y-1.5">
                {comps.map((c, i) => {
                  const figs = [
                    c.ev_ebitda != null && `EV/EBITDA ${c.ev_ebitda}x`,
                    c.ev_revenue != null && `EV/Rev ${c.ev_revenue}x`,
                    c.pe != null && `P/E ${c.pe}x`,
                    c.revenue_growth != null && `growth ${c.revenue_growth}%`,
                    c.ebitda_margin != null && `EBITDA mgn ${c.ebitda_margin}%`,
                  ].filter(Boolean).join(" · ");
                  return (
                    <label key={i} className="flex items-start gap-2 text-[12px] text-carbon">
                      <input type="checkbox" className="mt-0.5" checked={compSel[i]} onChange={() => toggle(compSel, setCompSel, i)} />
                      <span>
                        <strong>{c.name}</strong>{c.ticker && <span className="text-slate"> · {c.ticker}</span>}{c.relation && <span className="text-slate"> · {c.relation}</span>}
                        {figs && <span className="block text-[11px] text-graphite">{figs}{c.as_of ? ` (${c.as_of})` : ""}</span>}
                        <span className="block text-[10px] text-slate">{c.source}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* Key facts */}
          {x.keyFacts.length > 0 && (
            <section>
              <h4 className="text-[13px] font-semibold text-carbon mb-1">Other key facts</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {x.keyFacts.map((k, i) => (
                  <p key={i} className="text-[12px] text-carbon"><span className="text-slate">{k.label}:</span> {k.value} <span className="text-[10px] text-slate">({k.source})</span></p>
                ))}
              </div>
            </section>
          )}

          <label className="flex items-center gap-2 text-[12px] text-carbon">
            <input type="checkbox" checked={saveNote} onChange={() => setSaveNote(v => !v)} />
            Save the summary and key facts as an internal note
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-chalk">
          <p className="text-[11px] text-slate">Nothing changes on the profile until you apply.</p>
          <div className="flex items-center gap-2">
            {err && <span className="text-[12px] text-red-600">{err}</span>}
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="fill" size="sm" loading={applying} disabled={count === 0} onClick={apply}>
              Apply {count} change{count === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
