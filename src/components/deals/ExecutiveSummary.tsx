"use client";
// Executive summary of a deal: company overview, financial overview and
// transaction overview, laid out like the first page of an IC memo. The team
// edits everything; Claude can draft it from the company's documents.
import { Fragment, useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { autoCagr, type Bullet, type DealSummary, type FinYear, type TxRow } from "@/lib/dealSummary";

const C = { actual: "#0A231F", projected: "#42533E", line: "#9A8A5E", text: "#0A231F", muted: "#6B7B6B", grid: "#D9DBD4" };
const input = "text-[12px] bg-paper border border-chalk rounded-[6px] px-2 py-1 text-carbon focus:outline-none focus:border-carbon";

// "**Founded in 2015**, the Company…" → bold runs
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-carbon">{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>))}</>;
}

const bulletsToText = (b: Bullet[]) => b.map(x => (x.level ? `- ${x.text}` : x.text)).join("\n");
const textToBullets = (t: string): Bullet[] => t.split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim()).map(l => {
  const sub = /^\s*[-–—•]\s+/.test(l) || /^\s{2,}/.test(l);
  return { text: l.replace(/^\s*[-–—•]?\s*/, ""), level: sub ? 1 : 0 };
});

const fmtNum = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 1 });

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-chalk pb-1 mb-2">
      <h3 className="text-[15px] text-carbon font-medium">{children}</h3>
      {aside}
    </div>
  );
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function FinancialChart({ fin }: { fin: DealSummary["financial"] }) {
  const ys = fin.years;
  if (!ys.length) return <p className="text-[12px] text-slate py-6 text-center">No financials yet. Edit to add years.</p>;
  const W = 1000, H = 300, n = ys.length, colW = W / n, barW = Math.min(64, colW * 0.55);
  const maxRev = Math.max(...ys.map(y => y.revenue ?? 0), 1);
  const base = 236, barMax = 120;
  const margins = ys.map(y => y.margin).filter((m): m is number => m != null);
  const mMin = Math.min(...margins), mMax = Math.max(...margins);
  const my = (m: number) => (mMax === mMin ? 52 : 78 - ((m - mMin) / (mMax - mMin)) * 56); // margin band y 22..78
  const cx = (i: number) => colW * (i + 0.5);
  const linePts = ys.map((y, i) => (y.margin != null ? `${cx(i)},${my(y.margin)}` : null)).filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Revenue and EBITDA margin by year">
      {ys.map((y, i) => {
        const h = y.revenue ? (y.revenue / maxRev) * barMax : 0;
        return (
          <g key={i}>
            {h > 0 && <rect x={cx(i) - barW / 2} y={base - h} width={barW} height={h} fill={y.projected ? C.projected : C.actual} />}
            {y.revenue != null && <text x={cx(i)} y={base - h - 7} textAnchor="middle" fontSize="15" fontWeight="600" fill={C.text}>{fmtNum(y.revenue)}</text>}
            <text x={cx(i)} y={base + 22} textAnchor="middle" fontSize="15" fill={C.muted}>{y.label}</text>
          </g>
        );
      })}
      <line x1={0} x2={W} y1={base} y2={base} stroke={C.grid} />
      {linePts && <polyline points={linePts} fill="none" stroke={C.line} strokeWidth="3" />}
      {ys.map((y, i) => y.margin != null && (
        <g key={`m${i}`}>
          <rect x={cx(i) - 30} y={my(y.margin) - 12} width={60} height={24} fill="#fff" stroke={C.line} strokeWidth="1.5" />
          <text x={cx(i)} y={my(y.margin) + 5} textAnchor="middle" fontSize="14" fill={C.line}>{y.margin.toFixed(1)}%</text>
        </g>
      ))}
      <g transform={`translate(${W / 2 - 150}, ${H - 8})`} fontSize="14" fill={C.muted}>
        <rect x={0} y={-11} width={26} height={10} fill={C.actual} /><text x={32} y={-2}>Revenue</text>
        <line x1={130} x2={162} y1={-6} y2={-6} stroke={C.line} strokeWidth="3" /><text x={168} y={-2}>EBITDA margin</text>
      </g>
    </svg>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

function SummaryView({ s, onSaveTx }: { s: DealSummary; onSaveTx: (rows: TxRow[]) => Promise<boolean> }) {
  const fin = s.financial;
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Company Overview</SectionTitle>
        {s.companyOverview.length === 0 ? <p className="text-[12px] text-slate">Nothing yet.</p> : (
          <ul className="space-y-1.5">
            {s.companyOverview.map((b, i) => (
              <li key={i} className={`text-[13px] text-graphite leading-relaxed flex gap-2 ${b.level ? "pl-6" : ""}`}>
                <span className="shrink-0 text-carbon">{b.level ? "—" : "•"}</span>
                <span><Rich text={b.text} /></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle aside={<span className="text-[12px] text-graphite">{fin.unit && `(${fin.unit})`}{fin.scenario && ` | ${fin.scenario}`}</span>}>Financial Overview</SectionTitle>
        {/* On a phone the chart and its KPI rows keep a readable size and scroll sideways together. */}
        <div className="overflow-x-auto"><div className="min-w-[560px]">
        <div className="relative">
          {fin.cagr.some(c => c.label || c.value) && (
            <table className="absolute left-0 top-0 text-[11px] border border-carbon bg-paper z-10">
              <thead><tr><th colSpan={2} className="bg-carbon text-white font-semibold px-3 py-0.5">Revenue CAGR</th></tr></thead>
              <tbody>{fin.cagr.map((c, i) => <tr key={i}><td className="px-2 text-graphite">{c.label}</td><td className="px-2 text-right text-carbon">{c.value}</td></tr>)}</tbody>
            </table>
          )}
          <div className={fin.cagr.length ? "pt-12" : ""}><FinancialChart fin={fin} /></div>
        </div>
        {fin.rows.map((r, ri) => (
          <div key={ri} className="mt-2">
            <p className="text-[11px] font-semibold text-carbon text-center border-t border-carbon pt-1">{r.label}</p>
            <div className="grid bg-fog" style={{ gridTemplateColumns: `repeat(${Math.max(1, fin.years.length)}, minmax(0, 1fr))` }}>
              {fin.years.map((_, i) => <span key={i} className="text-[11px] text-graphite text-center py-1">{r.values[i] || ""}</span>)}
            </div>
          </div>
        ))}
        </div></div>
        {fin.footnote && <p className="text-[10px] text-slate mt-2">{fin.footnote}</p>}
      </section>

      <TransactionTable rows={s.transaction} onSave={onSaveTx} />
      {s.footnotes && <p className="text-[10px] text-slate whitespace-pre-line">{s.footnotes}</p>}
    </div>
  );
}

// Transaction overview, editable in place: click a cell, type, click out to save.
function TransactionTable({ rows, onSave }: { rows: TxRow[]; onSave: (rows: TxRow[]) => Promise<boolean> }) {
  const [local, setLocal] = useState(rows);
  useEffect(() => setLocal(rows), [rows]);
  const [saving, setSaving] = useState(false);
  async function commit(next: TxRow[]) {
    setLocal(next);
    if (JSON.stringify(next) === JSON.stringify(rows)) return;
    setSaving(true); await onSave(next); setSaving(false);
  }
  const set = (i: number, patch: Partial<TxRow>) => setLocal(l => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cell = "w-full bg-transparent resize-none focus:outline-none focus:bg-paper focus:ring-1 focus:ring-olive/40 px-1 -mx-1 py-0.5 placeholder:text-slate/70";
  const grow = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };
  return (
    <section>
      <SectionTitle aside={<span className="text-[10px] text-slate">{saving ? "Saving…" : "Click any cell to edit"}</span>}>Transaction Overview</SectionTitle>
      <table className="w-full text-[13px] border-collapse">
        <tbody>
          {local.map((r, i) => (
            <tr key={i} className={`group border border-chalk ${r.highlight ? "bg-[#DCE5D9]" : i % 2 ? "bg-fog/60" : ""}`}>
              <td className="px-3 py-1.5 w-[22%] align-top">
                <input value={r.label} onChange={e => set(i, { label: e.target.value })} onBlur={() => commit(local)} placeholder="Label"
                  className={`${cell} font-semibold text-carbon`} aria-label="Label" />
              </td>
              <td className="px-3 py-1.5 w-[32%] border-l border-chalk align-top">
                <textarea rows={1} value={r.value} ref={el => { if (el) grow(el); }} onChange={e => { set(i, { value: e.target.value }); grow(e.target); }} onBlur={() => commit(local)}
                  placeholder="—" className={`${cell} text-carbon`} aria-label={`${r.label} value`} />
              </td>
              <td className="px-3 py-1.5 border-l border-chalk align-top">
                <div className="flex gap-1">
                  <textarea rows={1} value={r.note} ref={el => { if (el) grow(el); }} onChange={e => { set(i, { note: e.target.value }); grow(e.target); }} onBlur={() => commit(local)}
                    placeholder="Note" className={`${cell} text-graphite`} aria-label={`${r.label} note`} />
                  <button onClick={() => commit(local.filter((_, j) => j !== i))} title="Remove row"
                    className="text-slate hover:text-red-600 text-[13px] opacity-60 sm:opacity-0 group-hover:opacity-100 focus:opacity-100">×</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setLocal(l => [...l, { label: "", value: "", note: "" }])} className="mt-2 text-[12px] font-medium text-forest hover:underline">+ Add row</button>
    </section>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────────

function SummaryEditor({ s, onChange }: { s: DealSummary; onChange: (s: DealSummary) => void }) {
  const [overview, setOverview] = useState(() => bulletsToText(s.companyOverview));
  const fin = s.financial;
  const setFin = (f: Partial<DealSummary["financial"]>) => onChange({ ...s, financial: { ...fin, ...f } });
  const setYear = (i: number, y: Partial<FinYear>) => setFin({ years: fin.years.map((x, j) => (j === i ? { ...x, ...y } : x)) });
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));

  function addYear() {
    const last = fin.years[fin.years.length - 1];
    const lastNum = last ? Number(last.label.replace(/\D/g, "")) : new Date().getFullYear() - 1;
    const projected = last ? last.projected || lastNum + 1 > new Date().getFullYear() : false;
    setFin({
      years: [...fin.years, { label: `${projected ? "E" : ""}${lastNum + 1}`, revenue: null, margin: null, projected }],
      rows: fin.rows.map(r => ({ ...r, values: [...r.values, ""] })),
    });
  }
  function removeYear(i: number) {
    setFin({ years: fin.years.filter((_, j) => j !== i), rows: fin.rows.map(r => ({ ...r, values: r.values.filter((_, j) => j !== i) })) });
  }
  const moveTx = (i: number, d: number) => {
    const t = [...s.transaction]; const j = i + d;
    if (j < 0 || j >= t.length) return;
    [t[i], t[j]] = [t[j], t[i]]; onChange({ ...s, transaction: t });
  };
  const setTx = (i: number, v: Partial<DealSummary["transaction"][number]>) => onChange({ ...s, transaction: s.transaction.map((r, j) => (j === i ? { ...r, ...v } : r)) });

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Company Overview</SectionTitle>
        <p className="text-[11px] text-slate mb-1">One bullet per line. Start a line with “- ” for a sub-bullet. Wrap words in **double asterisks** for bold.</p>
        <textarea value={overview} rows={Math.max(6, overview.split("\n").length + 1)}
          onChange={e => { setOverview(e.target.value); onChange({ ...s, companyOverview: textToBullets(e.target.value) }); }}
          className={`${input} w-full text-[13px] leading-relaxed font-mono`} placeholder={"**Founded in 2015**, the Company is a vertically integrated…\n- **Brand A (92% of 2025 sales)** is the flagship…"} />
      </section>

      <section>
        <SectionTitle>Financial Overview</SectionTitle>
        <div className="flex flex-wrap gap-3 mb-3">
          <label className="text-[11px] text-slate">Unit <input value={fin.unit} onChange={e => setFin({ unit: e.target.value })} className={`${input} ml-1 w-[110px]`} placeholder="MXN $m" /></label>
          <label className="text-[11px] text-slate">Scenario <input value={fin.scenario} onChange={e => setFin({ scenario: e.target.value })} className={`${input} ml-1 w-[130px]`} placeholder="Base Case" /></label>
        </div>
        <div className="overflow-x-auto">
          <table className="text-[12px]">
            <tbody>
              <tr>
                <td className="pr-2 text-slate whitespace-nowrap">Year</td>
                {fin.years.map((y, i) => (
                  <td key={i} className="p-0.5">
                    <div className="flex items-center gap-0.5">
                      <input value={y.label} onChange={e => setYear(i, { label: e.target.value })} className={`${input} w-[64px]`} />
                      <button onClick={() => removeYear(i)} className="text-slate hover:text-red-600 text-[13px]" title="Remove year">×</button>
                    </div>
                  </td>
                ))}
                <td className="pl-2"><button onClick={addYear} className="text-[11px] text-forest font-medium whitespace-nowrap hover:underline">+ Year</button></td>
              </tr>
              <tr>
                <td className="pr-2 text-slate whitespace-nowrap">Revenue</td>
                {fin.years.map((y, i) => <td key={i} className="p-0.5"><input inputMode="decimal" value={y.revenue ?? ""} onChange={e => setYear(i, { revenue: numOrNull(e.target.value) })} className={`${input} w-[76px] text-right`} /></td>)}
              </tr>
              <tr>
                <td className="pr-2 text-slate whitespace-nowrap">EBITDA margin %</td>
                {fin.years.map((y, i) => <td key={i} className="p-0.5"><input inputMode="decimal" value={y.margin ?? ""} onChange={e => setYear(i, { margin: numOrNull(e.target.value) })} className={`${input} w-[76px] text-right`} /></td>)}
              </tr>
              <tr>
                <td className="pr-2 text-slate whitespace-nowrap">Projected</td>
                {fin.years.map((y, i) => <td key={i} className="p-0.5 text-center"><input type="checkbox" checked={y.projected} onChange={e => setYear(i, { projected: e.target.checked })} /></td>)}
              </tr>
              {fin.rows.map((r, ri) => (
                <tr key={`r${ri}`}>
                  <td className="pr-2 py-0.5">
                    <div className="flex items-center gap-0.5">
                      <input value={r.label} onChange={e => setFin({ rows: fin.rows.map((x, j) => (j === ri ? { ...x, label: e.target.value } : x)) })} className={`${input} w-[110px]`} placeholder="e.g. Total stores" />
                      <button onClick={() => setFin({ rows: fin.rows.filter((_, j) => j !== ri) })} className="text-slate hover:text-red-600 text-[13px]" title="Remove row">×</button>
                    </div>
                  </td>
                  {fin.years.map((_, i) => (
                    <td key={i} className="p-0.5"><input value={r.values[i] ?? ""} onChange={e => setFin({ rows: fin.rows.map((x, j) => (j === ri ? { ...x, values: fin.years.map((__, k) => (k === i ? e.target.value : x.values[k] ?? "")) } : x)) })} className={`${input} w-[76px] text-right`} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => setFin({ rows: [...fin.rows, { label: "", values: fin.years.map(() => "") }] })} className="text-[11px] text-forest font-medium hover:underline mt-1">+ KPI row (e.g. stores, customers)</button>

        <div className="mt-3">
          <div className="flex items-center gap-3 mb-1">
            <p className="text-[12px] text-carbon font-medium">Revenue CAGR</p>
            <button onClick={() => setFin({ cagr: autoCagr(fin.years) })} className="text-[11px] text-forest font-medium hover:underline">Calculate from the years</button>
            <button onClick={() => setFin({ cagr: [...fin.cagr, { label: "", value: "" }] })} className="text-[11px] text-forest font-medium hover:underline">+ Row</button>
          </div>
          {fin.cagr.map((c, i) => (
            <div key={i} className="flex items-center gap-1 mb-1">
              <input value={c.label} onChange={e => setFin({ cagr: fin.cagr.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className={`${input} w-[110px]`} placeholder="'20 - '25" />
              <input value={c.value} onChange={e => setFin({ cagr: fin.cagr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} className={`${input} w-[80px] text-right`} placeholder="38.1%" />
              <button onClick={() => setFin({ cagr: fin.cagr.filter((_, j) => j !== i) })} className="text-slate hover:text-red-600 text-[13px]">×</button>
            </div>
          ))}
        </div>
        <input value={fin.footnote} onChange={e => setFin({ footnote: e.target.value })} className={`${input} w-full mt-2`} placeholder="Chart footnote (optional)" />
        <div className="mt-3 border border-chalk rounded-[8px] p-2"><p className="text-[10px] text-slate mb-1">Preview</p><FinancialChart fin={fin} /></div>
      </section>

      <section>
        <SectionTitle>Transaction Overview</SectionTitle>
        <div className="space-y-1">
          {s.transaction.map((r, i) => (
            <div key={i} className="flex items-start gap-1">
              <input value={r.label} onChange={e => setTx(i, { label: e.target.value })} className={`${input} w-[130px]`} placeholder="Label" />
              <textarea value={r.value} rows={1} onChange={e => setTx(i, { value: e.target.value })} className={`${input} w-[200px] resize-y`} placeholder="Value" />
              <textarea value={r.note} rows={1} onChange={e => setTx(i, { note: e.target.value })} className={`${input} flex-1 resize-y`} placeholder="Note" />
              <label className="text-[10px] text-slate flex items-center gap-1 pt-1.5" title="Highlight this row"><input type="checkbox" checked={!!r.highlight} onChange={e => setTx(i, { highlight: e.target.checked })} />Hl</label>
              <button onClick={() => moveTx(i, -1)} className="text-slate hover:text-carbon px-0.5 pt-1" title="Move up">↑</button>
              <button onClick={() => moveTx(i, 1)} className="text-slate hover:text-carbon px-0.5 pt-1" title="Move down">↓</button>
              <button onClick={() => onChange({ ...s, transaction: s.transaction.filter((_, j) => j !== i) })} className="text-slate hover:text-red-600 px-0.5 pt-1" title="Remove">×</button>
            </div>
          ))}
        </div>
        <button onClick={() => onChange({ ...s, transaction: [...s.transaction, { label: "", value: "", note: "" }] })} className="text-[11px] text-forest font-medium hover:underline mt-1">+ Row</button>
      </section>

      <section>
        <p className="text-[12px] text-carbon font-medium mb-1">Footnotes</p>
        <textarea value={s.footnotes} rows={2} onChange={e => onChange({ ...s, footnotes: e.target.value })} className={`${input} w-full`} placeholder="1. Projections assume…" />
      </section>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function ExecutiveSummary({ dealId }: { dealId: string }) {
  const [summary, setSummary] = useState<DealSummary | null>(null);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<DealSummary | null>(null); // while editing
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}/summary`);
    if (!res.ok) { setError("Couldn't load the executive summary"); return; }
    const j = await res.json();
    setSummary(j.summary); setSaved(j.saved);
  }, [dealId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!draft) return;
    setBusy("save"); setError(null);
    const res = await fetch(`/api/deals/${dealId}/summary`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary: draft }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(j.error ?? "Couldn't save"); return; }
    setSummary(j.summary); setSaved(true); setDraft(null);
  }

  // Saves just the transaction rows, keeping the rest of the summary as it is.
  async function saveTx(rows: TxRow[]) {
    if (!summary) return false;
    setError(null);
    const res = await fetch(`/api/deals/${dealId}/summary`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary: { ...summary, transaction: rows } }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Couldn't save"); return false; }
    setSummary(j.summary); setSaved(true);
    return true;
  }

  async function aiDraft() {
    if ((draft || saved) && !confirm("Replace what's written with a new draft from the company's documents? You can still review it before saving.")) return;
    setBusy("ai"); setError(null);
    const res = await fetch(`/api/deals/${dealId}/summary`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(j.error ?? "Couldn't write the draft"); return; }
    setDraft(j.summary); setEditorKey(k => k + 1);
  }

  const isEmpty = (s: DealSummary) => !s.companyOverview.length && !s.financial.years.length && s.transaction.every(t => !t.value && !t.note);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-graphite">Executive Summary</p>
          {summary?.updatedAt && !draft && <p className="text-[10px] text-slate">Edited by {summary.updatedBy} · {new Date(summary.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>}
          {!saved && summary && !draft && !isEmpty(summary) && <p className="text-[10px] text-slate">Prefilled from the company&apos;s data; edit and save to keep it.</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          {draft ? (
            <>
              <Button size="sm" variant="ghost" loading={busy === "ai"} disabled={!!busy} onClick={aiDraft}>Draft with AI</Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setDraft(null)}>Cancel</Button>
              <Button size="sm" variant="fill" loading={busy === "save"} disabled={!!busy} onClick={save}>Save</Button>
            </>
          ) : summary && (
            <>
              <Button size="sm" variant="ghost" loading={busy === "ai"} disabled={!!busy} onClick={aiDraft}>Draft with AI</Button>
              <Button size="sm" variant="outline" onClick={() => { setDraft(structuredClone(summary)); setEditorKey(k => k + 1); }}>Edit</Button>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-[12px] text-red-600 mb-2">{error}</p>}
      {busy === "ai" && <p className="text-[12px] text-graphite mb-2">Reading the company&apos;s documents and writing a draft… (about 30 seconds)</p>}
      {!summary ? <p className="text-[12px] text-slate">Loading…</p>
        : draft ? <SummaryEditor key={editorKey} s={draft} onChange={setDraft} />
        : isEmpty(summary) ? (
          <div className="space-y-6">
            <div className="text-center py-4">
              <p className="text-[13px] text-carbon">No executive summary yet</p>
              <p className="text-[12px] text-slate mt-1">Write the company, financial and transaction overview, or let Claude draft it from the documents.</p>
            </div>
            <TransactionTable rows={summary.transaction} onSave={saveTx} />
          </div>
        ) : <SummaryView s={summary} onSaveTx={saveTx} />}
    </Card>
  );
}
