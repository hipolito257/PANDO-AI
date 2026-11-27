"use client";
// Fundraising › Google Sheet: paste the link; the platform works out how the
// whole workbook is organised (every tab), syncs it, and shows how it read it
// so anything can be adjusted. Re-reads the layout by itself when it changes.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type TabPlan = { name: string; use: boolean; why: string; headerRow: number; type: string | null; stage: string | null; columns: Record<string, number> };
type Plan = { summary: string; tabs: TabPlan[]; by: "ai" | "guess" | "manual" };
type Summary = { rows: number; investors: number; created: number; updated: number; contacts: number; tabs: string[];
  changes: { investor: string; field: string; from: string | null; to: string | null; kind: string }[]; notInSheet: string[] };
type Sync = { sourceUrl: string; frequency: string; plan: Plan | null; lastRunAt: string | null; lastStatus: string | null; lastError: string | null; lastSummary: Summary | null };
type TabInfo = { name: string; rows: number; headers: string[]; sample: string[][] };
type Opt = { key: string; label: string };
type Data = { sync: Sync | null; tabs: TabInfo[] | { error: string } | null; fields: Opt[]; types: Opt[]; stages: Opt[]; serviceAccount: string | null };

const input = "w-full px-2.5 py-1.5 text-[13px] bg-fog border border-chalk text-carbon focus:outline-none focus:border-olive";
const small = "px-2 py-1 text-[12px] bg-fog border border-chalk text-carbon focus:outline-none focus:border-olive";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const BY: Record<string, string> = { ai: "Read by AI", guess: "Read from the column titles", manual: "Adjusted by the team" };

export default function FundraisingSheetPage() {
  const [d, setD] = useState<Data | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/fundraising/sheet?columns=1");
    if (!r.ok) { setErr("Couldn't load the sheet settings"); return; }
    const j: Data = await r.json();
    setD(j); setPlan(j.sync?.plan ?? null); setDirty(false); if (j.sync) setUrl(j.sync.sourceUrl);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call(method: string, body: unknown, label: string) {
    setBusy(label); setErr(null);
    const r = await fetch("/api/fundraising/sheet", { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) setErr(j.error ?? "Something went wrong");
    await load();
    return r.ok;
  }
  const setTab = (name: string, patch: Partial<TabPlan>) => { setPlan(p => (p ? { ...p, tabs: p.tabs.map(t => (t.name === name ? { ...t, ...patch } : t)) } : p)); setDirty(true); };

  const tabs = Array.isArray(d?.tabs) ? d.tabs : [];
  const sum = d?.sync?.lastSummary;
  const fieldLabel = (k: string) => d?.fields.find(f => f.key === k)?.label ?? k;
  const working = busy === "connect" || busy === "replan" || busy === "sync";

  return (
    <div>
      <Topbar title="Google Sheet" subtitle="Feeds Fundraising every day, and whenever you sync" />
      <div className="p-6 space-y-4 max-w-5xl">
        <Link href="/fundraising/investors" className="inline-flex items-center gap-2 text-[12px] text-graphite hover:text-carbon">← Investor map</Link>
        {err && <Card><p className="text-[12px] text-red-600">{err}</p></Card>}

        <Card>
          <SectionHeader title="The file" subtitle="Any layout works: several tabs, titles anywhere, Spanish or English. The platform works out what each tab and column is." />
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className={input} />
            <Button variant="fill" size="sm" loading={busy === "connect"} disabled={!url.trim() || !!busy} onClick={() => call("PUT", { url }, "connect")}>
              {d?.sync ? "Reconnect" : "Connect"}
            </Button>
          </div>
          {d?.serviceAccount && <p className="text-[11px] text-slate mt-2">Keep the file <b>Restricted</b> and share it (Viewer) with <span className="font-mono text-carbon select-all">{d.serviceAccount}</span>.</p>}
          {working && <p className="text-[12px] text-graphite mt-3">Reading every tab and working out how the file is organised… this can take up to a minute.</p>}
        </Card>

        {d?.sync && (
          <Card>
            <SectionHeader title="Last sync" subtitle={`${when(d.sync.lastRunAt)}${d.sync.lastStatus === "error" ? " · failed" : ""}`}
              action={<div className="flex flex-wrap gap-2">
                <Button variant="fill" size="sm" loading={busy === "sync"} disabled={!!busy} onClick={() => call("POST", {}, "sync")}>Sync now</Button>
                <select value={d.sync.frequency} onChange={e => call("PATCH", { frequency: e.target.value }, "freq")} className={small} aria-label="Frequency">
                  <option value="daily">Every day (automatic)</option>
                  <option value="manual">Only when I sync</option>
                </select>
              </div>} />
            {d.sync.lastStatus === "error" && d.sync.lastError && <p className="text-[12px] text-red-600 mb-2">{d.sync.lastError}</p>}
            {sum && d.sync.lastStatus !== "error" && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[["Tabs read", sum.tabs?.length ?? 1], ["Investors", sum.investors], ["Added", sum.created], ["Updated", sum.updated], ["New people", sum.contacts]].map(([l, v]) => (
                    <div key={String(l)} className="bg-fog px-3 py-2"><p className="font-display text-[22px] text-carbon leading-none">{v}</p><p className="text-[10px] text-slate mt-1">{l}</p></div>
                  ))}
                </div>
                {sum.changes.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-[12px] text-forest cursor-pointer">See the {sum.changes.length} changes</summary>
                    <div className="mt-2 max-h-[320px] overflow-y-auto border border-chalk">
                      <table className="w-full text-[12px]"><tbody>
                        {sum.changes.map((c, i) => (
                          <tr key={i} className="border-b border-chalk last:border-0">
                            <td className="px-3 py-1.5 font-medium text-carbon whitespace-nowrap">{c.investor}</td>
                            <td className="px-3 py-1.5 text-slate whitespace-nowrap">{c.field}</td>
                            <td className="px-3 py-1.5 text-graphite">{c.from ? <><span className="line-through text-slate">{c.from}</span> → </> : null}{c.to}</td>
                          </tr>
                        ))}
                      </tbody></table>
                    </div>
                  </details>
                )}
                {sum.notInSheet.length > 0 && <p className="text-[11px] text-slate mt-2">No longer in the file (kept in the platform): {sum.notInSheet.join(", ")}</p>}
              </>
            )}
            <p className="text-[11px] text-slate mt-3">New investors and people are added; values that changed in the file since the last sync are updated. What you edit in the platform stays until that cell changes in the file. Nothing is deleted.</p>
          </Card>
        )}

        {d?.sync && plan && (
          <Card>
            <SectionHeader title="How your file was read" subtitle={BY[plan.by] ?? ""}
              action={<div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" loading={busy === "replan"} disabled={!!busy} onClick={() => confirm("Read the whole file again from scratch? Your adjustments below are replaced.") && call("POST", { replan: true }, "replan")}>Read it again with AI</Button>
                {dirty && <Button variant="fill" size="sm" loading={busy === "plan"} disabled={!!busy} onClick={async () => { if (await call("PATCH", { plan }, "plan")) await call("POST", {}, "sync"); }}>Save and sync</Button>}
              </div>} />
            {plan.summary && <p className="text-[13px] text-graphite leading-relaxed mb-4">{plan.summary}</p>}
            {d.tabs && !Array.isArray(d.tabs) && <p className="text-[12px] text-red-600 mb-2">{d.tabs.error}</p>}
            <div className="space-y-2">
              {plan.tabs.map(tp => {
                const info = tabs.find(t => t.name === tp.name);
                const mapped = Object.entries(tp.columns).sort((a, b) => a[1] - b[1]);
                return (
                  <div key={tp.name} className={`border p-3 ${tp.use ? "border-olive/40 bg-paper" : "border-chalk bg-fog/40"}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-[13px] font-medium text-carbon">
                        <input type="checkbox" checked={tp.use} onChange={e => setTab(tp.name, { use: e.target.checked })} />
                        {tp.name}
                      </label>
                      <span className="text-[11px] text-slate">{info ? `${info.rows} rows` : ""}{tp.why ? ` · ${tp.why}` : ""}</span>
                      {tp.use && (
                        <span className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-graphite">
                          <label>Whole tab is
                            <select value={tp.type ?? ""} onChange={e => setTab(tp.name, { type: e.target.value || null })} className={`${small} ml-1`}>
                              <option value="">any type (from a column)</option>
                              {d.types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                            </select></label>
                          <label>Stage
                            <select value={tp.stage ?? ""} onChange={e => setTab(tp.name, { stage: e.target.value || null })} className={`${small} ml-1`}>
                              <option value="">from a column</option>
                              {d.stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </select></label>
                          <label>Titles on row
                            <input type="number" min={1} max={50} value={tp.headerRow} onChange={e => setTab(tp.name, { headerRow: Number(e.target.value) || 1 })} className={`${small} ml-1 w-14`} /></label>
                        </span>
                      )}
                    </div>
                    {tp.use && (
                      <>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {mapped.length === 0 && <span className="text-[11px] text-red-600">No columns recognised: pick at least the investor column.</span>}
                          {mapped.map(([f, c]) => (
                            <span key={f} className="text-[11px] bg-pistacho/40 border border-pistacho px-2 py-0.5 text-olive">
                              {fieldLabel(f)} ← {info?.headers[c - 1] ?? `column ${c}`}
                            </span>
                          ))}
                          <button onClick={() => setOpen(o => (o === tp.name ? null : tp.name))} className="text-[11px] text-forest hover:underline ml-1">{open === tp.name ? "Done" : "Adjust columns"}</button>
                        </div>
                        {open === tp.name && info && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-chalk">
                            {d.fields.map(f => (
                              <label key={f.key} className="flex items-center gap-2 text-[11px]">
                                <span className="w-[110px] shrink-0 text-graphite">{f.label}{f.key === "name" && " *"}</span>
                                <select value={tp.columns[f.key] ?? ""} className={small + " w-full"}
                                  onChange={e => {
                                    const cols = { ...tp.columns };
                                    if (e.target.value) cols[f.key] = Number(e.target.value); else delete cols[f.key];
                                    setTab(tp.name, { columns: cols });
                                  }}>
                                  <option value="">—</option>
                                  {info.headers.map((h, i) => <option key={i} value={i + 1}>{h}{info.sample[0]?.[i] ? ` (e.g. ${info.sample[0][i]})` : ""}</option>)}
                                </select>
                              </label>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {d?.sync && (
          <button onClick={() => confirm("Disconnect the file? Investors already imported stay.") && call("DELETE", null, "del")} className="text-[11px] text-slate hover:text-red-600">Disconnect the file</button>
        )}
      </div>
    </div>
  );
}
