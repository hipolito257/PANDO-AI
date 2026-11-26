"use client";
// Fundraising › Google Sheet: connect the investors sheet, check which column is
// which, sync now, and see what the last sync changed.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type Summary = { rows: number; investors: number; created: number; updated: number; contacts: number; trigger?: string;
  changes: { investor: string; field: string; from: string | null; to: string | null; kind: string }[]; notInSheet: string[] };
type Sync = { sourceUrl: string; sheetName: string | null; headerRow: number; columnMap: Record<string, string>; frequency: string;
  lastRunAt: string | null; lastStatus: string | null; lastError: string | null; lastSummary: Summary | null };
type Data = { sync: Sync | null; columns: { tabs: string[]; headers: string[]; sample: string[][] } | { error: string } | null;
  fields: { key: string; label: string; required: boolean }[]; serviceAccount: string | null };

const input = "w-full px-2.5 py-1.5 text-[13px] bg-fog border border-chalk text-carbon focus:outline-none focus:border-olive";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

export default function FundraisingSheetPage() {
  const [d, setD] = useState<Data | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await fetch("/api/fundraising/sheet?columns=1");
    if (!r.ok) { setErr("Couldn't load the sheet settings"); return; }
    const j: Data = await r.json();
    setD(j); setMap(j.sync?.columnMap ?? {}); if (j.sync) setUrl(j.sync.sourceUrl);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call(method: string, body?: unknown, label = method) {
    setBusy(label); setErr(null);
    const r = await fetch("/api/fundraising/sheet", { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) setErr(j.error ?? "Something went wrong");
    await load();
    return r.ok;
  }

  const cols = d?.columns && "headers" in d.columns ? d.columns : null;
  const sum = d?.sync?.lastSummary;

  return (
    <div>
      <Topbar title="Google Sheet" subtitle="Feeds Fundraising every day, and whenever you sync" />
      <div className="p-6 space-y-4 max-w-4xl">
        <Link href="/fundraising/investors" className="inline-flex items-center gap-2 text-[12px] text-graphite hover:text-carbon">← Investor map</Link>
        {err && <Card><p className="text-[12px] text-red-600">{err}</p></Card>}

        <Card>
          <SectionHeader title="1. The sheet" subtitle="One row per investor. If an investor has several people, repeat the investor's name on one row per person." />
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className={input} />
            <Button variant="fill" size="sm" loading={busy === "PUT"} disabled={!url.trim() || !!busy} onClick={() => call("PUT", { url }, "PUT")}>{d?.sync ? "Update" : "Connect"}</Button>
          </div>
          {d?.serviceAccount && (
            <p className="text-[11px] text-slate mt-2">Keep the sheet <b>Restricted</b> and share it (Viewer) with <span className="font-mono text-carbon select-all">{d.serviceAccount}</span>. Nobody else gets access.</p>
          )}
          {cols && cols.tabs.length > 1 && (
            <label className="block mt-3 text-[12px] text-graphite">Tab
              <select value={d?.sync?.sheetName ?? ""} onChange={e => call("PUT", { url, sheetName: e.target.value }, "tab")} className={`${input} mt-1 sm:w-[260px]`}>
                {cols.tabs.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
          )}
          {d?.columns && "error" in d.columns && <p className="text-[12px] text-red-600 mt-2">{d.columns.error}</p>}
        </Card>

        {d?.sync && cols && (
          <Card>
            <SectionHeader title="2. Which column is which" subtitle="Guessed from the titles; fix anything that's off. Only the investor's name is required." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              {d.fields.map(f => (
                <label key={f.key} className="flex items-center gap-2 text-[12px]">
                  <span className="w-[140px] shrink-0 text-graphite">{f.label}{f.required && " *"}</span>
                  <select value={map[f.key] ?? ""} onChange={e => setMap(m => ({ ...m, [f.key]: e.target.value }))} className={input}>
                    <option value="">— not in the sheet —</option>
                    {cols.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <label className="text-[12px] text-graphite">Titles are on row
                <input type="number" min={1} max={30} defaultValue={d.sync.headerRow} onBlur={e => Number(e.target.value) !== d.sync!.headerRow && call("PATCH", { headerRow: Number(e.target.value) }, "row")}
                  className="ml-2 w-16 px-2 py-1 text-[12px] bg-fog border border-chalk" /></label>
              <label className="text-[12px] text-graphite">Sync
                <select value={d.sync.frequency} onChange={e => call("PATCH", { frequency: e.target.value }, "freq")} className="ml-2 px-2 py-1 text-[12px] bg-fog border border-chalk">
                  <option value="daily">Every day (automatic)</option>
                  <option value="manual">Only when I press Sync</option>
                </select></label>
              <Button size="sm" variant="outline" loading={busy === "map"} disabled={!!busy} onClick={() => call("PATCH", { columnMap: map }, "map")}>Save columns</Button>
            </div>
          </Card>
        )}

        {d?.sync && (
          <Card>
            <SectionHeader title="3. Sync" subtitle={`Last sync: ${when(d.sync.lastRunAt)}${d.sync.lastStatus === "error" ? " · failed" : ""}`}
              action={<Button variant="fill" size="sm" loading={busy === "POST"} disabled={!!busy} onClick={() => call("POST", undefined, "POST")}>Sync now</Button>} />
            <p className="text-[12px] text-slate">The sheet adds new investors and people, and updates the values that changed in the sheet since the last sync. What you edit in the platform stays until someone changes that cell in the sheet. Nothing is deleted.</p>
            {d.sync.lastStatus === "error" && d.sync.lastError && <p className="text-[12px] text-red-600 mt-2">{d.sync.lastError}</p>}
            {sum && d.sync.lastStatus !== "error" && (
              <div className="mt-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[["Investors in the sheet", sum.investors], ["Added", sum.created], ["Updated", sum.updated], ["New people", sum.contacts]].map(([l, v]) => (
                    <div key={String(l)} className="bg-fog px-3 py-2"><p className="font-display text-[22px] text-carbon leading-none">{v}</p><p className="text-[10px] text-slate mt-1">{l}</p></div>
                  ))}
                </div>
                {sum.changes.length > 0 && (
                  <div className="mt-3 max-h-[320px] overflow-y-auto border border-chalk">
                    <table className="w-full text-[12px]">
                      <tbody>
                        {sum.changes.map((c, i) => (
                          <tr key={i} className="border-b border-chalk last:border-0">
                            <td className="px-3 py-1.5 font-medium text-carbon whitespace-nowrap">{c.investor}</td>
                            <td className="px-3 py-1.5 text-slate whitespace-nowrap">{c.field}</td>
                            <td className="px-3 py-1.5 text-graphite">{c.from ? <><span className="line-through text-slate">{c.from}</span> → </> : null}{c.to}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {sum.notInSheet.length > 0 && <p className="text-[11px] text-slate mt-2">No longer in the sheet (kept in the platform): {sum.notInSheet.join(", ")}</p>}
              </div>
            )}
            <button onClick={() => confirm("Disconnect the sheet? Investors already imported stay.") && call("DELETE", undefined, "del")} className="mt-4 text-[11px] text-slate hover:text-red-600">Disconnect the sheet</button>
          </Card>
        )}
      </div>
    </div>
  );
}
