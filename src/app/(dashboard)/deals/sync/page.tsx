"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetchJson";
import type { Stage } from "@/components/deals/dealUi";

type Field = { key: string; label: string; required?: boolean };
type ColumnMap = Record<string, string | undefined>;
type Sync = {
  id: string; name: string; sourceUrl: string; fileKind: string; sheetName: string | null; headerRow: number;
  columnMap: ColumnMap; stageMap: Record<string, string>; sizeUnit: number; frequency: string; hookToken: string;
  lastRunAt: string | null; lastStatus: string | null; lastError: string | null;
};
type Change = {
  id: string; kind: "update" | "create" | "missing" | "warning"; row?: number; dealId?: string; dealName?: string; companyName?: string;
  field?: string; fromLabel?: string; toLabel?: string; message?: string;
  create?: { company: string; codeName: string; stage: string; companyId: string | null };
};
type Run = { id: string; trigger: string; status: string; rowCount: number; changeCount: number; error: string | null; appliedCount: number | null; createdAt: string };
type Data = {
  sync: Sync | null; runs: Run[]; pending: (Run & { changes: Change[] }) | null;
  stages: Stage[]; fields: Field[]; serviceAccount: string | null;
};
type Preview = {
  kind: string; tabs: string[]; sheetName: string; headerRow: number; headers: string[]; sample: string[][]; rowCount: number;
  columnMap: ColumnMap; stageValues: { key: string; value: string; count: number; mapped: string | null }[];
};

const FREQ = [
  { value: "immediate", label: "Immediate", hint: "Right after someone edits the sheet (needs a small script in the Google Sheet, below)" },
  { value: "daily",     label: "Daily",     hint: "Every morning" },
  { value: "weekly",    label: "Weekly",    hint: "Once a week" },
  { value: "monthly",   label: "Monthly",   hint: "Once a month" },
  { value: "manual",    label: "Only when I click “Sync now”", hint: "" },
];
const FIELD_NAME: Record<string, string> = {
  stage: "Stage", onHold: "Status", type: "Type", lead: "Lead", dealSize: "Size", currency: "Currency", statusNote: "Comments", description: "Description",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pending_review: { label: "Waiting for review", cls: "bg-orange/10 text-orange" },
  no_changes:     { label: "No changes",         cls: "bg-fog text-graphite" },
  applied:        { label: "Applied",            cls: "bg-green-50 text-green-700" },
  dismissed:      { label: "Dismissed",          cls: "bg-fog text-slate" },
  superseded:     { label: "Replaced by a newer reading", cls: "bg-fog text-slate" },
  error:          { label: "Error",              cls: "bg-red-50 text-red-700" },
};
const TRIGGER: Record<string, string> = { manual: "Sync now", cron: "Scheduled", hook: "Sheet edited" };

const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never";
const input = "w-full text-[13px] bg-paper border border-chalk rounded-[8px] px-3 py-2 text-carbon focus:outline-none focus:border-carbon";

export default function SheetSyncPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchJson<Data>("/api/sheet-sync");
      setData(d); setLoadError(false);
      if (!d.sync) setEditing(true);
    } catch { setLoadError(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function syncNow() {
    setBusy("sync"); setMsg(null);
    const res = await fetch("/api/sheet-sync/run", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) setMsg({ text: j.error ?? "Couldn't read the sheet", error: true });
    else setMsg({ text: j.changes ? `Read ${j.rowCount} rows: ${j.changes} change${j.changes === 1 ? "" : "s"} to review below.` : `Read ${j.rowCount} rows: everything already matches.` });
    load();
  }

  if (loadError) return (
    <div><Topbar title="Google Sheet sync" />
      <div className="p-6"><Card><p className="text-[13px] mb-2">Couldn&apos;t load the sync settings</p><Button size="sm" variant="outline" onClick={load}>Try again</Button></Card></div>
    </div>
  );
  if (!data) return <div><Topbar title="Google Sheet sync" /><div className="p-6"><Card><p className="text-[13px] text-slate">Loading…</p></Card></div></div>;

  const { sync } = data;
  return (
    <div>
      <Topbar title="Google Sheet sync"
        subtitle={sync ? `${FREQ.find(f => f.value === sync.frequency)?.label ?? sync.frequency} · last read ${fmtWhen(sync.lastRunAt)}` : "Keep the deals in step with the team's tracker"}
        actions={sync && <Button size="sm" variant="fill" loading={busy === "sync"} onClick={syncNow}>Sync now</Button>} />
      <div className="p-6 space-y-4 max-w-[1100px]">
        <Link href="/deals" className="text-[12px] text-slate hover:text-carbon">← Deals</Link>
        {msg && <p className={`text-[13px] ${msg.error ? "text-red-600" : "text-graphite"}`}>{msg.text}</p>}
        {sync?.lastStatus === "error" && sync.lastError && !msg && (
          <Card className="border border-red-200"><p className="text-[13px] text-red-700"><b>The last reading failed:</b> {sync.lastError}</p></Card>
        )}

        {data.pending && <Review run={data.pending} stages={data.stages} onDone={(t) => { setMsg({ text: t }); load(); }} />}

        {editing ? (
          <Setup data={data} onSaved={() => { setEditing(false); setMsg({ text: "Saved. Click “Sync now” to read the sheet." }); load(); }}
            onCancel={sync ? () => setEditing(false) : undefined} />
        ) : sync && (
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-slate font-semibold mb-1">Connected sheet</p>
                <a href={sync.sourceUrl} target="_blank" rel="noreferrer" className="text-[13px] text-carbon hover:underline break-all">{sync.sourceUrl}</a>
                <p className="text-[12px] text-graphite mt-1">
                  Tab “{sync.sheetName ?? "first"}” · headers on row {sync.headerRow} · {Object.values(sync.columnMap).filter(Boolean).length} columns mapped · {FREQ.find(f => f.value === sync.frequency)?.label}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit settings</Button>
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (!confirm("Disconnect the sheet? The deals stay as they are.")) return;
                  await fetch("/api/sheet-sync", { method: "DELETE" }); load();
                }}>Disconnect</Button>
              </div>
            </div>
          </Card>
        )}

        {sync?.frequency === "immediate" && !editing && <ImmediateSetup sync={sync} />}

        {data.runs.length > 0 && (
          <Card padding="none">
            <p className="text-[13px] font-semibold text-carbon px-5 pt-4 pb-2">Readings</p>
            <table className="w-full text-[12px]">
              <thead><tr className="border-y border-chalk text-slate text-[10px] uppercase tracking-wide">
                {["When", "Trigger", "Rows", "Changes", "Result"].map(h => <th key={h} className="text-left font-semibold px-5 py-2">{h}</th>)}
              </tr></thead>
              <tbody>
                {data.runs.map(r => (
                  <tr key={r.id} className="border-b border-chalk last:border-0">
                    <td className="px-5 py-2 text-graphite">{fmtWhen(r.createdAt)}</td>
                    <td className="px-5 py-2 text-graphite">{TRIGGER[r.trigger] ?? r.trigger}</td>
                    <td className="px-5 py-2 text-graphite">{r.status === "error" ? "—" : r.rowCount}</td>
                    <td className="px-5 py-2 text-graphite">{r.status === "applied" ? `${r.appliedCount ?? 0} of ${r.changeCount} applied` : r.changeCount || "—"}</td>
                    <td className="px-5 py-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS[r.status]?.cls ?? ""}`}>{STATUS[r.status]?.label ?? r.status}</span>
                      {r.error && <span className="block text-[11px] text-red-600 mt-0.5">{r.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Review ────────────────────────────────────────────────────────────────────

function Review({ run, stages, onDone }: { run: Run & { changes: Change[] }; stages: Stage[]; onDone: (msg: string) => void }) {
  const actionable = run.changes.filter(c => c.kind === "update" || c.kind === "create");
  const notes = run.changes.filter(c => c.kind === "missing" || c.kind === "warning");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(actionable.map(c => c.id)));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of actionable) {
      const k = c.kind === "create" ? `new:${c.id}` : c.dealId!;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.values()];
  }, [actionable]);

  const toggle = (ids: string[], on: boolean) => setSelected(s => { const n = new Set(s); ids.forEach(id => (on ? n.add(id) : n.delete(id))); return n; });

  async function act(action: "apply" | "dismiss") {
    setBusy(action); setError(null);
    const res = await fetch(`/api/sheet-sync/runs/${run.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "apply" ? { action, ids: [...selected] } : { action }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(j.error ?? "Something went wrong"); return; }
    onDone(action === "apply" ? `${j.applied} change${j.applied === 1 ? "" : "s"} applied to the deals.` : "Changes dismissed. They won't be proposed again unless the sheet changes them again.");
  }

  return (
    <Card className="border border-orange/40">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-[14px] font-semibold text-carbon">{actionable.length} change{actionable.length === 1 ? "" : "s"} from the sheet to review</p>
          <p className="text-[12px] text-slate">Read {fmtWhen(run.createdAt)} ({TRIGGER[run.trigger] ?? run.trigger}). Nothing changes on the deals until you apply it. Unticked changes are skipped.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="ghost" loading={busy === "dismiss"} disabled={!!busy} onClick={() => act("dismiss")}>Dismiss all</Button>
          <Button size="sm" variant="fill" loading={busy === "apply"} disabled={!!busy || selected.size === 0} onClick={() => act("apply")}>Apply {selected.size} selected</Button>
        </div>
      </div>
      {error && <p className="text-[12px] text-red-600 mb-2">{error}</p>}
      <div className="flex gap-3 text-[11px] text-slate mb-2">
        <button className="hover:text-carbon" onClick={() => toggle(actionable.map(c => c.id), true)}>Select all</button>
        <button className="hover:text-carbon" onClick={() => toggle(actionable.map(c => c.id), false)}>Select none</button>
      </div>
      <div className="divide-y divide-chalk border border-chalk rounded-[8px]">
        {groups.map(list => {
          const first = list[0];
          const ids = list.map(c => c.id);
          const allOn = ids.every(id => selected.has(id));
          return (
            <div key={first.id} className="px-4 py-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allOn} onChange={() => toggle(ids, !allOn)} />
                <span className="text-[13px] font-semibold text-carbon">{first.dealName}</span>
                {first.companyName && first.companyName !== first.dealName && <span className="text-[12px] text-slate">{first.companyName}</span>}
                {first.kind === "create" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-carbon text-white">New deal{first.create?.companyId ? "" : " + company"}</span>}
                {first.row && <span className="ml-auto text-[11px] text-slate">row {first.row}</span>}
              </label>
              <div className="pl-6 mt-1 space-y-0.5">
                {first.kind === "create" ? (
                  <p className="text-[12px] text-graphite">Creates the deal in <b>{stages.find(st => st.key === first.create?.stage)?.label ?? first.create?.stage}</b>{first.create?.companyId ? ` on the existing company ${first.companyName}` : ` and the company “${first.create?.company}”`}.</p>
                ) : list.map(c => (
                  <label key={c.id} className="flex items-center gap-2 text-[12px] text-graphite cursor-pointer">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle([c.id], !selected.has(c.id))} />
                    <span className="w-[80px] text-slate">{FIELD_NAME[c.field ?? ""] ?? c.field}</span>
                    <span className="line-through text-slate">{c.fromLabel}</span>
                    <span>→</span>
                    <span className="text-carbon font-medium">{c.toLabel}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {notes.length > 0 && (
        <div className="mt-3 space-y-1">
          {notes.map(n => <p key={n.id} className="text-[12px] text-graphite">⚠ {n.message}</p>)}
        </div>
      )}
    </Card>
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function Setup({ data, onSaved, onCancel }: { data: Data; onSaved: () => void; onCancel?: () => void }) {
  const s = data.sync;
  const [url, setUrl] = useState(s?.sourceUrl ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(s?.sheetName ?? null);
  const [headerRow, setHeaderRow] = useState<number | null>(s?.headerRow ?? null);
  const [columnMap, setColumnMap] = useState<ColumnMap>(s?.columnMap ?? {});
  const [stageMap, setStageMap] = useState<Record<string, string>>(s?.stageMap ?? {});
  const [sizeUnit, setSizeUnit] = useState(s?.sizeUnit ?? 1);
  const [frequency, setFrequency] = useState(s?.frequency ?? "weekly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async (opts: { sheetName?: string | null; headerRow?: number | null; columnMap?: ColumnMap } = {}) => {
    setBusy("read"); setError(null);
    const res = await fetch("/api/sheet-sync/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, sheetName: opts.sheetName ?? sheetName, headerRow: opts.headerRow ?? headerRow, columnMap: opts.columnMap ?? columnMap, stageMap }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(j.error ?? "Couldn't read the file"); setPreview(null); return; }
    const p = j as Preview;
    setPreview(p); setSheetName(p.sheetName); setHeaderRow(p.headerRow); setColumnMap(p.columnMap);
    setStageMap(m => { const n = { ...m }; for (const v of p.stageValues) if (!n[v.key] && v.mapped) n[v.key] = v.mapped; return n; });
  }, [url, sheetName, headerRow, columnMap, stageMap]);

  // Re-open the saved connection with its preview.
  useEffect(() => { if (s?.sourceUrl) read(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy("save"); setError(null);
    const res = await fetch("/api/sheet-sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceUrl: url, sheetName, headerRow, columnMap, stageMap, sizeUnit, frequency }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(j.error ?? "Couldn't save"); return; }
    onSaved();
  }

  const unmapped = preview?.stageValues.filter(v => !stageMap[v.key]) ?? [];
  const sampleCols = preview ? preview.headers.map((h, i) => ({ h, i })).filter(({ h }) => Object.values(columnMap).includes(h)) : [];

  return (
    <Card>
      <p className="text-[14px] font-semibold text-carbon">1. The sheet</p>
      <p className="text-[12px] text-slate mb-2">
        Paste the link of the Google Sheet (or of the Excel file in Google Drive).{" "}
        {data.serviceAccount
          ? <>Share it as Viewer with <b className="text-graphite select-all">{data.serviceAccount}</b> so only the platform can read it.</>
          : <>In Google Drive, set sharing to “Anyone with the link · Viewer” so the platform can read it.</>}
      </p>
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className={input} />
        <Button size="sm" variant="outline" loading={busy === "read"} disabled={!url.trim()} onClick={() => { setSheetName(null); setHeaderRow(null); read({ sheetName: null, headerRow: null, columnMap: {} }); }}>Read sheet</Button>
      </div>
      {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}

      {preview && (
        <>
          <div className="flex flex-wrap gap-4 mt-4">
            <label className="text-[12px] text-graphite">Tab
              <select value={sheetName ?? ""} onChange={e => { setSheetName(e.target.value); read({ sheetName: e.target.value, headerRow: null, columnMap: {} }); }} className={`${input} mt-1 w-[220px]`}>
                {preview.tabs.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-graphite">Column titles are on row
              <input type="number" min={1} max={50} value={headerRow ?? 1} onChange={e => setHeaderRow(Number(e.target.value))}
                onBlur={() => read({ columnMap: {} })} className={`${input} mt-1 w-[90px]`} />
            </label>
            <p className="text-[12px] text-slate self-end pb-2">{preview.rowCount} rows found</p>
          </div>

          <p className="text-[14px] font-semibold text-carbon mt-5">2. Which column is which</p>
          <p className="text-[12px] text-slate mb-2">Guessed from the column titles; fix anything that&apos;s off. Company and Stage are required.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
            {data.fields.map(f => (
              <label key={f.key} className="text-[12px] text-graphite">
                {f.label}{f.required && <span className="text-orange"> *</span>}
                <select value={columnMap[f.key] ?? ""} onChange={e => {
                  const m = { ...columnMap, [f.key]: e.target.value || undefined };
                  setColumnMap(m);
                  if (f.key === "stage") read({ columnMap: m });
                }} className={`${input} mt-1`}>
                  <option value="">—</option>
                  {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          {columnMap.dealSize && (
            <label className="block text-[12px] text-graphite mt-2">Plain numbers in the size column are in
              <select value={sizeUnit} onChange={e => setSizeUnit(Number(e.target.value))} className={`${input} mt-1 w-[200px]`}>
                <option value={1}>units (150000000)</option>
                <option value={1e3}>thousands (150000)</option>
                <option value={1e6}>millions (150)</option>
              </select>
            </label>
          )}

          {sampleCols.length > 0 && (
            <div className="overflow-x-auto mt-3 border border-chalk rounded-[8px]">
              <table className="w-full text-[11px]">
                <thead><tr className="bg-fog">{sampleCols.map(({ h }) => (
                  <th key={h} className="text-left font-semibold px-3 py-1.5 text-graphite whitespace-nowrap">
                    {h}<span className="block font-normal text-slate">{data.fields.find(f => columnMap[f.key] === h)?.label}</span>
                  </th>
                ))}</tr></thead>
                <tbody>{preview.sample.map((r, i) => (
                  <tr key={i} className="border-t border-chalk">{sampleCols.map(({ h, i: c }) => <td key={h} className="px-3 py-1.5 text-carbon max-w-[220px] truncate">{r[c]}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {preview.stageValues.length > 0 && (
            <>
              <p className="text-[14px] font-semibold text-carbon mt-5">3. Stages</p>
              <p className="text-[12px] text-slate mb-2">How each value in the sheet&apos;s stage column maps to the platform&apos;s stages.{unmapped.length ? ` ${unmapped.length} still need a stage.` : ""}</p>
              <div className="border border-chalk rounded-[8px] divide-y divide-chalk">
                {preview.stageValues.map(v => (
                  <div key={v.key} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="text-[12px] text-carbon flex-1">{v.value} <span className="text-slate">· {v.count} deal{v.count === 1 ? "" : "s"}</span></span>
                    <select value={stageMap[v.key] ?? ""} onChange={e => setStageMap(m => ({ ...m, [v.key]: e.target.value }))}
                      className={`text-[12px] bg-paper border rounded-[6px] px-2 py-1 w-[220px] ${stageMap[v.key] ? "border-chalk" : "border-orange"}`}>
                      <option value="">Choose a stage…</option>
                      {data.stages.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}
                      <option value="__hold">On hold (keep stage)</option>
                      <option value="__ignore">Ignore</option>
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="text-[14px] font-semibold text-carbon mt-5">4. How often to check the sheet</p>
          <div className="mt-1 space-y-1">
            {FREQ.map(f => (
              <label key={f.value} className="flex items-start gap-2 text-[13px] text-carbon cursor-pointer">
                <input type="radio" name="freq" className="mt-1" checked={frequency === f.value} onChange={() => setFrequency(f.value)} />
                <span>{f.label}{f.hint && <span className="block text-[11px] text-slate">{f.hint}</span>}</span>
              </label>
            ))}
          </div>
          {frequency === "immediate" && preview.kind !== "gsheet" && (
            <p className="text-[12px] text-orange mt-2">Immediate needs a native Google Sheet. This is an Excel file in Drive: open it and use File → Save as Google Sheets, then paste the new link, or pick another frequency.</p>
          )}
          <p className="text-[12px] text-slate mt-2">Every reading only proposes changes: someone approves them here before the deals change. You can also click “Sync now” at any time.</p>

          <div className="flex gap-2 mt-5">
            <Button size="sm" variant="fill" loading={busy === "save"} disabled={!columnMap.company || !columnMap.stage} onClick={save}>Save</Button>
            {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
          </div>
        </>
      )}
    </Card>
  );
}

// ── Immediate (Apps Script) ───────────────────────────────────────────────────

function ImmediateSetup({ sync }: { sync: Sync }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const script = `// PANDO: tells the platform the deal tracker changed.
function notifyPando() {
  UrlFetchApp.fetch("${origin}/api/cron/sheet-hook", {
    method: "post",
    headers: { "x-pando-token": "${sync.hookToken}" },
    muteHttpExceptions: true,
  });
}`;
  return (
    <Card>
      <p className="text-[14px] font-semibold text-carbon">Turn on immediate sync in the Google Sheet</p>
      <ol className="text-[12px] text-graphite list-decimal pl-5 mt-1 space-y-0.5">
        <li>In the sheet: <b>Extensions → Apps Script</b>. Delete what&apos;s there and paste the code below. Save.</li>
        <li>On the left, open <b>Triggers</b> (clock icon) → <b>Add trigger</b>: function <code>notifyPando</code>, event source <b>From spreadsheet</b>, event type <b>On change</b>. Save and allow access.</li>
        <li>Edit a cell: about 20 seconds later the changes show up here for review.</li>
      </ol>
      <div className="relative mt-3">
        <pre className="text-[11px] bg-fog rounded-[8px] p-3 overflow-x-auto text-carbon">{script}</pre>
        <button className="absolute top-2 right-2 text-[11px] bg-paper border border-chalk rounded-[6px] px-2 py-0.5 hover:border-carbon"
          onClick={() => { navigator.clipboard.writeText(script); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-[11px] text-slate mt-2">The code carries this connection&apos;s private key: only paste it into your own sheet. The daily check still runs as a backup.</p>
    </Card>
  );
}
