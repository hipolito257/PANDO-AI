"use client";
// One investor (LP): profile, people, AI research and the fit / probability score.
// Everything is editable in place; the Google Sheet and the AI research feed it.
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { INVESTOR_STAGES, INVESTOR_TYPES, fmtMoney, investorTypeInfo, scoreTone, type Investor, type InvestorContact, type InvestorResearch } from "@/lib/fundraising";

type Data = { investor: Investor & { owner: { id: string; name: string } | null }; contacts: InvestorContact[]; team: { id: string; name: string }[] };
type Tab = "overview" | "people" | "research";

const input = "w-full px-2 py-1.5 text-[13px] bg-fog border border-chalk text-carbon focus:outline-none focus:border-olive";
const lbl = "block text-[10px] uppercase tracking-[.14em] text-slate mb-1";
const SOURCE: Record<string, string> = { sheet: "From the sheet", ai: "Found by AI", manual: "Added by hand" };

export default function InvestorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [tab, setTab] = useState<Tab>("overview");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/investors/${id}`).catch(() => null);
    if (!r?.ok) { setState("error"); return; }
    setData(await r.json()); setState("ok");
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // While the AI research runs (in the background), check every few seconds.
  const running = data?.investor.researchStatus === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [running, load]);

  async function save(fields: Record<string, unknown>) {
    setErr(null);
    setData(d => (d ? { ...d, investor: { ...d.investor, ...fields } as Data["investor"] } : d));
    const r = await fetch(`/api/investors/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
    if (!r.ok) setErr("Couldn't save the change");
    await load();
  }
  async function contact(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) {
    setErr(null);
    const r = await fetch(`/api/investors/${id}/contacts`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "Couldn't save the contact");
    await load();
    return r.ok;
  }
  async function research() {
    setErr(null);
    const r = await fetch(`/api/investors/${id}/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Couldn't start the research"); return; }
    setTab("research");
    await load();
  }

  if (state === "loading") return <div><Topbar title="Investor" /><div className="p-6"><Card><p className="text-[13px] text-slate">Loading…</p></Card></div></div>;
  if (state === "error" || !data) return <div><Topbar title="Investor" /><div className="p-6"><Card><p className="text-[13px] mb-2">Couldn&apos;t load this investor</p><Button size="sm" variant="outline" onClick={load}>Try again</Button></Card></div></div>;

  const inv = data.investor;
  const res: InvestorResearch | null = inv.research ? JSON.parse(inv.research) : null;
  const known = new Set(data.contacts.map(c => c.name.toLowerCase()));
  const suggested = (res?.people ?? []).filter(p => !known.has(p.name.toLowerCase()));

  return (
    <div>
      <Topbar title={inv.name} subtitle={[investorTypeInfo(inv.type).label, [inv.city, inv.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
        actions={<Button variant="outline" size="sm" disabled={running} onClick={research}>{running ? "Researching…" : res ? "Refresh AI research" : "Research with AI"}</Button>} />
      <div className="p-6 space-y-4">
        <Link href="/fundraising/investors" className="inline-flex items-center gap-2 text-[12px] text-graphite hover:text-carbon">← Investor map</Link>
        {err && <Card><p className="text-[12px] text-red-600">{err}</p></Card>}

        {/* ── Header: identity, pipeline and the score ── */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex-1 min-w-[260px] space-y-3">
              <input defaultValue={inv.name} key={inv.name} onBlur={e => e.target.value.trim() && e.target.value !== inv.name && save({ name: e.target.value })}
                className="w-full font-display text-[24px] text-carbon bg-transparent border-b border-transparent hover:border-chalk focus:border-olive focus:outline-none" aria-label="Name" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <label><span className={lbl}>Type</span>
                  <select value={inv.type} onChange={e => save({ type: e.target.value })} className={input}>{INVESTOR_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
                <label><span className={lbl}>Stage</span>
                  <select value={inv.stage} onChange={e => save({ stage: e.target.value })} className={input}>{INVESTOR_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
                <label><span className={lbl}>Pando owner</span>
                  <select value={inv.ownerId ?? ""} onChange={e => save({ ownerId: e.target.value })} className={input}>
                    <option value="">Nobody</option>{data.team.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full sm:w-auto">
              <ScoreTile label="Fit with Pando" suffix="/100" value={inv.fitScore ?? null} onSave={v => save({ fitScore: v })} />
              <ScoreTile label="Chance to commit" suffix="%" value={inv.probability ?? null} onSave={v => save({ probability: v })} />
              <p className="col-span-2 text-[10px] text-slate">
                {inv.scoreSource === "manual" ? <>Set by hand{res?.fit != null && <> · <button className="underline" onClick={() => save({ fitScore: res.fit, probability: res.probability, scoreSource: "ai" })}>use the AI&apos;s ({res.fit} / {res.probability}%)</button></>}</>
                  : inv.scoreSource === "ai" ? `From the AI research${inv.scoredAt ? ` · ${new Date(inv.scoredAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""} · click a number to change it`
                  : "No score yet: run the AI research, or click a number to set it."}
              </p>
            </div>
          </div>
        </Card>

        {/* ── Tabs ── */}
        <div className="border-b border-chalk">
          <div role="tablist" className="flex gap-1 overflow-x-auto no-scrollbar -mb-px">
            {([["overview", "Overview"], ["people", `People${data.contacts.length ? ` · ${data.contacts.length}` : ""}`], ["research", running ? "AI research · running" : "AI research"]] as [Tab, string][]).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`shrink-0 px-3 py-2.5 text-[12px] font-medium border-b-2 transition-colors duration-300 whitespace-nowrap ${tab === k ? "border-olive text-carbon" : "border-transparent text-slate hover:text-carbon"}`}>{label}</button>
            ))}
          </div>
        </div>

        {tab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <SectionHeader title="Profile" subtitle="Click any field to edit. Filled from the Google Sheet and the AI research; your edits are kept." />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Website" value={inv.website} onSave={v => save({ website: v })} link />
                <Field label="LinkedIn" value={inv.linkedinUrl} onSave={v => save({ linkedinUrl: v })} link />
                <Field label="City" value={inv.city} onSave={v => save({ city: v })} />
                <Field label="Country" value={inv.country} onSave={v => save({ country: v })} />
                <Field label={`AUM (${inv.currency})`} value={inv.aum} money currency={inv.currency} onSave={v => save({ aum: v })} />
                <label><span className={lbl}>Currency</span>
                  <select value={inv.currency} onChange={e => save({ currency: e.target.value })} className={input}>{["USD", "MXN", "EUR"].map(c => <option key={c}>{c}</option>)}</select></label>
                <Field label="Typical ticket, from" value={inv.ticketMin} money currency={inv.currency} onSave={v => save({ ticketMin: v })} />
                <Field label="Typical ticket, up to" value={inv.ticketMax} money currency={inv.currency} onSave={v => save({ ticketMax: v })} />
                <Field label="What they invest in" value={inv.focus} onSave={v => save({ focus: v })} wide />
                <Field label="Geographies" value={inv.geographies} onSave={v => save({ geographies: v })} wide />
                <Field label="Description" value={inv.description} onSave={v => save({ description: v })} wide area />
              </div>
            </Card>
            <div className="space-y-4">
              <Card>
                <SectionHeader title="With Pando" />
                <div className="space-y-3">
                  <Field label="Ticket we aim for" value={inv.targetAmount} money currency={inv.currency} onSave={v => save({ targetAmount: v })} />
                  <Field label="Committed" value={inv.committedAmount} money currency={inv.currency} onSave={v => save({ committedAmount: v })} />
                  <Field label="Next step" value={inv.nextStep} onSave={v => save({ nextStep: v })} />
                  <label className="block"><span className={lbl}>Next step date</span>
                    <input type="date" defaultValue={inv.nextStepDate ?? ""} key={inv.nextStepDate ?? ""} onBlur={e => e.target.value !== (inv.nextStepDate ?? "") && save({ nextStepDate: e.target.value || null })} className={input} /></label>
                </div>
              </Card>
              <Card>
                <SectionHeader title="Notes" />
                <textarea defaultValue={inv.notes ?? ""} key={inv.updatedAt} rows={6} placeholder="Relationship, meetings, what they asked…"
                  onBlur={e => e.target.value !== (inv.notes ?? "") && save({ notes: e.target.value })} className={`${input} resize-y`} />
              </Card>
              <button className="text-[11px] text-slate hover:text-red-600" onClick={async () => {
                if (!confirm(`Delete ${inv.name} and its contacts? This can't be undone.`)) return;
                await fetch(`/api/investors/${id}`, { method: "DELETE" });
                router.push("/fundraising/investors");
              }}>Delete investor</button>
            </div>
          </div>
        )}

        {tab === "people" && (
          <div className="space-y-4">
            <Card>
              <SectionHeader title="People" subtitle="Everyone you know at this investor. The star marks the main contact." />
              {data.contacts.length === 0 && <p className="text-[12px] text-slate mb-3">Nobody yet. Add someone below, or run the AI research to find who leads it.</p>}
              <div className="space-y-3">
                {data.contacts.map(c => <ContactRow key={c.id} c={c} onSave={f => contact("PATCH", { contactId: c.id, ...f })} onDelete={() => confirm(`Remove ${c.name}?`) && contact("DELETE", { contactId: c.id })} />)}
              </div>
              <form className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 mt-4 pt-4 border-t border-chalk" onSubmit={async e => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (await contact("POST", { name: f.get("name"), role: f.get("role"), email: f.get("email") })) (e.target as HTMLFormElement).reset();
              }}>
                <input name="name" required placeholder="Name" className={input} />
                <input name="role" placeholder="Role (e.g. CIO)" className={input} />
                <input name="email" type="email" placeholder="Email" className={input} />
                <Button type="submit" size="sm" variant="outline">Add person</Button>
              </form>
            </Card>
            {suggested.length > 0 && (
              <Card>
                <SectionHeader title="Suggested by the AI research" subtitle="People who lead or decide at this investor, found on the web. Add the ones worth contacting." />
                <div className="space-y-2">
                  {suggested.map(p => (
                    <div key={p.name} className="flex flex-wrap items-center gap-3 border border-chalk px-3 py-2">
                      <div className="flex-1 min-w-[200px]">
                        <p className="text-[13px] font-medium text-carbon">{p.name}</p>
                        <p className="text-[11px] text-graphite">{p.title}{p.email ? ` · ${p.email}` : ""}{p.phone ? ` · ${p.phone}` : ""}</p>
                        {p.linkedinUrl && <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-forest hover:underline">LinkedIn</a>}
                      </div>
                      <Button size="sm" variant="outline" onClick={async () => {
                        await fetch(`/api/investors/${id}/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addPerson: p }) });
                        load();
                      }}>+ Add</Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === "research" && <ResearchView inv={inv} res={res} running={running} onRun={research} />}
      </div>
    </div>
  );
}

// A number that edits in place (0-100).
function ScoreTile({ label, suffix, value, onSave }: { label: string; suffix: string; value: number | null; onSave: (v: number | null) => void }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className={`border px-4 py-3 min-w-[130px] ${scoreTone(value)}`}>
      <p className="text-[10px] uppercase tracking-[.14em] opacity-80">{label}</p>
      {edit ? (
        <input autoFocus type="number" min={0} max={100} defaultValue={value ?? ""} aria-label={label}
          onBlur={e => { setEdit(false); const v = e.target.value === "" ? null : Number(e.target.value); if (v !== value) onSave(v); }}
          onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="mt-1 w-20 text-[24px] font-display bg-paper text-carbon px-1 focus:outline-none" />
      ) : (
        <button onClick={() => setEdit(true)} className="mt-1 font-display text-[28px] leading-none" title="Click to change">
          {value ?? "—"}<span className="text-[13px] ml-0.5 opacity-70">{value != null ? suffix : ""}</span>
        </button>
      )}
    </div>
  );
}

// Label + value that edits in place and saves on blur.
function Field({ label, value, onSave, money, currency, link, wide, area }: {
  label: string; value: string | number | null | undefined; onSave: (v: string | number | null) => void;
  money?: boolean; currency?: string; link?: boolean; wide?: boolean; area?: boolean;
}) {
  const shown = value ?? "";
  const commit = (raw: string) => {
    const t = raw.trim();
    if (money) {
      const n = t ? Number(t.replace(/[,\s$]/g, "")) : null;
      if (n !== (value ?? null) && (n === null || Number.isFinite(n))) onSave(n);
    } else if (t !== String(shown)) onSave(t || null);
  };
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className={lbl}>{label}{money && value != null ? <span className="normal-case tracking-normal ml-1 text-graphite">({fmtMoney(Number(value), currency)})</span> : null}
        {link && value ? <a href={String(value).startsWith("http") ? String(value) : `https://${value}`} target="_blank" rel="noopener noreferrer" className="normal-case tracking-normal ml-1 text-forest hover:underline">open ↗</a> : null}</span>
      {area
        ? <textarea defaultValue={String(shown)} key={String(shown)} rows={3} onBlur={e => commit(e.target.value)} className={`${input} resize-y`} />
        : <input defaultValue={String(shown)} key={String(shown)} placeholder="—" onBlur={e => commit(e.target.value)} className={input} />}
    </label>
  );
}

function ContactRow({ c, onSave, onDelete }: { c: InvestorContact; onSave: (f: Record<string, unknown>) => void; onDelete: () => void }) {
  const cell = "w-full bg-transparent text-[12px] focus:outline-none focus:bg-fog px-1 py-0.5 placeholder:text-slate/60";
  const blur = (k: keyof InvestorContact) => (e: React.FocusEvent<HTMLInputElement>) => { if (e.target.value !== (c[k] ?? "")) onSave({ [k]: e.target.value }); };
  return (
    <div className="border border-chalk p-3 group">
      <div className="flex items-start gap-2">
        <button onClick={() => !c.isPrimary && onSave({ isPrimary: true })} title={c.isPrimary ? "Main contact" : "Make main contact"}
          className={`text-[15px] leading-none mt-1 ${c.isPrimary ? "text-amber-500" : "text-chalk hover:text-amber-400"}`}>★</button>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-1">
          <input defaultValue={c.name} onBlur={blur("name")} className={`${cell} font-semibold text-carbon text-[13px]`} aria-label="Name" />
          <input defaultValue={c.role ?? ""} onBlur={blur("role")} placeholder="Role" className={`${cell} text-graphite`} aria-label="Role" />
          <input defaultValue={c.email ?? ""} onBlur={blur("email")} placeholder="Email" className={`${cell} text-carbon`} aria-label="Email" />
          <input defaultValue={c.phone ?? ""} onBlur={blur("phone")} placeholder="Phone" className={`${cell} text-carbon`} aria-label="Phone" />
          <input defaultValue={c.linkedinUrl ?? ""} onBlur={blur("linkedinUrl")} placeholder="LinkedIn URL" className={`${cell} text-graphite sm:col-span-2`} aria-label="LinkedIn" />
          <input defaultValue={c.notes ?? ""} onBlur={blur("notes")} placeholder="Notes" className={`${cell} text-graphite sm:col-span-2`} aria-label="Notes" />
        </div>
        <button onClick={onDelete} className="text-slate hover:text-red-600 opacity-60 sm:opacity-0 group-hover:opacity-100" title="Remove">×</button>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-1.5 pl-6 text-[10px] text-slate">
        <span>{SOURCE[c.source] ?? c.source}</span>
        {c.email && <a href={`mailto:${c.email}`} className="text-forest hover:underline">Email</a>}
        {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-forest hover:underline">LinkedIn ↗</a>}
      </div>
    </div>
  );
}

function ResearchView({ inv, res, running, onRun }: { inv: Investor; res: InvestorResearch | null; running: boolean; onRun: () => void }) {
  if (running) return (
    <Card className="text-center py-10">
      <p className="text-[14px] text-carbon">Researching {inv.name} on the web…</p>
      <p className="text-[12px] text-slate mt-1">What they invest in, how much, where, their LP commitments and their people. It takes 1 to 3 minutes; you can leave this page.</p>
    </Card>
  );
  if (!res) return (
    <Card className="text-center py-10">
      {inv.researchStatus === "error" && <p className="text-[12px] text-red-600 mb-3">The last research failed: {inv.researchError}</p>}
      <p className="font-display text-[20px] text-carbon">Let the AI research this investor</p>
      <p className="text-[12px] text-slate mt-2 mb-5 max-w-lg mx-auto">Claude searches the web for what {inv.name} invests in, ticket sizes, geographies, the funds it has backed and who decides there, then scores how well it fits Pando and the chance it commits. It fills empty fields of the profile; your own values are never overwritten.</p>
      <Button variant="fill" size="sm" onClick={onRun}>Research with AI</Button>
    </Card>
  );
  const chips = (xs: string[]) => <div className="flex flex-wrap gap-1.5">{xs.map(x => <span key={x} className="text-[11px] bg-fog border border-chalk px-2 py-0.5 text-graphite">{x}</span>)}</div>;
  const list = (xs: string[]) => <ul className="space-y-1">{xs.map((x, i) => <li key={i} className="text-[12px] text-graphite leading-relaxed flex gap-2"><span className="text-carbon">•</span>{x}</li>)}</ul>;
  return (
    <div className="space-y-4">
      {inv.researchStatus === "error" && <Card><p className="text-[12px] text-red-600">The last refresh failed: {inv.researchError}. Showing the previous research.</p></Card>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <SectionHeader title="Who they are" subtitle={inv.researchedAt ? `Researched ${new Date(inv.researchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : undefined} />
          <p className="text-[13px] text-graphite leading-relaxed">{res.summary}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {res.investsIn.length > 0 && <div><p className={lbl}>Invests in</p>{chips(res.investsIn)}</div>}
            {res.sectors.length > 0 && <div><p className={lbl}>Sectors</p>{chips(res.sectors)}</div>}
            {res.geographies.length > 0 && <div><p className={lbl}>Geographies</p>{chips(res.geographies)}</div>}
            <div><p className={lbl}>Size and ticket</p>
              <p className="text-[12px] text-graphite">AUM {res.aum.amount ? fmtMoney(res.aum.amount, res.aum.currency) : "unknown"}{res.aum.asOf ? ` (${res.aum.asOf})` : ""}</p>
              <p className="text-[12px] text-graphite">Ticket {res.ticket.min || res.ticket.max ? `${fmtMoney(res.ticket.min, res.ticket.currency)} – ${fmtMoney(res.ticket.max, res.ticket.currency)}` : "unknown"}{res.ticket.note ? ` · ${res.ticket.note}` : ""}</p></div>
          </div>
        </Card>
        <Card>
          <SectionHeader title="Why this score" subtitle={`Fit ${res.fit ?? "—"}/100 · ${res.probability ?? "—"}% chance`} />
          {list(res.rationale)}
          {res.approach && <><p className={`${lbl} mt-4`}>How to approach them</p><p className="text-[12px] text-graphite leading-relaxed">{res.approach}</p></>}
        </Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><SectionHeader title="Strengths" />{res.strengths.length ? list(res.strengths) : <p className="text-[12px] text-slate">—</p>}</Card>
        <Card><SectionHeader title="Concerns" />{res.concerns.length ? list(res.concerns) : <p className="text-[12px] text-slate">—</p>}</Card>
      </div>
      {(res.lpActivity.length > 0 || res.directInvestments.length > 0) && (
        <Card>
          <SectionHeader title="Track record" subtitle="Funds they've committed to as LP, and direct investments" />
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <tbody>
                {res.lpActivity.map((x, i) => (
                  <tr key={`lp${i}`} className="border-b border-chalk"><td className="py-1.5 pr-3 text-slate whitespace-nowrap">LP</td><td className="py-1.5 pr-3 text-carbon">{x.fund}{x.manager ? ` · ${x.manager}` : ""}</td><td className="py-1.5 pr-3 text-graphite whitespace-nowrap">{x.year}</td><td className="py-1.5 text-graphite whitespace-nowrap">{x.amount}</td></tr>
                ))}
                {res.directInvestments.map((x, i) => (
                  <tr key={`d${i}`} className="border-b border-chalk"><td className="py-1.5 pr-3 text-slate whitespace-nowrap">Direct</td><td className="py-1.5 pr-3 text-carbon">{x.company}{x.note ? ` · ${x.note}` : ""}</td><td className="py-1.5 pr-3 text-graphite whitespace-nowrap">{x.year}</td><td /></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {res.sources.length > 0 && (
        <Card>
          <SectionHeader title="Sources" />
          <ul className="space-y-1">{res.sources.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-forest hover:underline break-all">{s.title || s.url}</a></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
