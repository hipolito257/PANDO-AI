// AI research on a possible investor (LP) for Pando: Claude searches the web for
// what they invest in, how much, where, their LP commitments and their people,
// then scores how well they fit Pando and how likely they are to commit.
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, investors, investorContacts, firmSettings } from "@/lib/db";
import { FIRM_SETTINGS_ID, getFirmThesis } from "@/lib/firmThesis";
import { INVESTOR_TYPES, investorStageInfo, type InvestorResearch } from "@/lib/fundraising";

const MODEL = "claude-sonnet-5-5";

const SYSTEM = `You are the fundraising analyst of Pando, a Mexican private equity firm raising a fund from limited partners (LPs). You research one prospective investor with web search and judge how good a prospect it is for Pando's fund.

Research, using web search (several searches; prefer the investor's own site, regulators, press releases, LinkedIn, fund databases and reputable press):
- Who they are: type of investor, headquarters, size (AUM), who runs it.
- What they invest in: asset classes, whether they commit to private equity funds as an LP (and to emerging or first-time managers), sectors, stages, geographies, Mexico / Latin America exposure.
- How much: typical ticket per fund commitment or deal.
- Track record: funds they have committed to as LP (fund, manager, year, amount) and notable direct investments.
- People: the decision makers for private markets / alternatives (CIO, head of private equity, partners, family principals) with title. Include an email, phone or LinkedIn URL ONLY when it is published publicly; never guess or construct emails.

Then score:
- fit (0-100): how well the investor matches Pando's fund (Mexico-focused growth private equity, mid-market, active value creation), considering whether they invest in PE funds as LPs, Mexico/LatAm appetite, ticket size relative to the fund target, appetite for emerging managers, regulatory constraints (e.g. AFOREs invest through CKDs/CERPIs) and any links to Mexico.
- probability (0-100): the chance they commit to this fund, combining fit with where they are in Pando's pipeline, the relationship and engagement in the notes, and any timing signals (new allocations, recent commitments, fund cycles).
Be calibrated: most cold prospects are below 30% probability; reserve 70%+ for advanced, engaged investors with a strong fit.

Answer with ONLY one JSON object, no prose before or after:
{
  "summary": "3-5 sentences on who they are and what matters for Pando",
  "investorType": one of ${JSON.stringify(INVESTOR_TYPES.map(t => t.key))},
  "website": "", "linkedinUrl": "",
  "hq": { "city": "", "country": "" },
  "aum": { "amount": null, "currency": "USD", "asOf": "", "source": "" },
  "ticket": { "min": null, "max": null, "currency": "USD", "note": "" },
  "investsIn": ["e.g. Private equity funds (LP)", "Real estate"],
  "sectors": [], "geographies": [],
  "lpActivity": [ { "fund": "", "manager": "", "year": "", "amount": "", "source": "" } ],
  "directInvestments": [ { "company": "", "year": "", "note": "", "source": "" } ],
  "people": [ { "name": "", "title": "", "email": "", "phone": "", "linkedinUrl": "", "source": "" } ],
  "fit": 0, "probability": 0,
  "rationale": ["why these scores, 3-6 short points"],
  "strengths": [], "concerns": [],
  "approach": "how Pando should approach them and the next step",
  "sources": [ { "title": "", "url": "" } ]
}
Amounts as plain numbers in units (25000000 for 25m). Unknown values: null or "" (never invent). Write in English.`;

const arr = <T,>(v: unknown, f: (x: Record<string, unknown>) => T, max = 20): T[] =>
  Array.isArray(v) ? v.slice(0, max).map(x => f((x ?? {}) as Record<string, unknown>)) : [];
const s = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : v == null ? "" : String(v).slice(0, max));
const n = (v: unknown) => { const x = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s$]/g, "")); return v == null || v === "" || !Number.isFinite(x) ? null : x; };
const pct = (v: unknown) => { const x = n(v); return x == null ? null : Math.max(0, Math.min(100, Math.round(x))); };

export function normalizeResearch(raw: unknown): InvestorResearch {
  const r = (raw ?? {}) as Record<string, unknown>;
  const o = (k: string) => ((r[k] ?? {}) as Record<string, unknown>);
  return {
    summary: s(r.summary, 2000), investorType: s(r.investorType, 40),
    website: s(r.website, 300), linkedinUrl: s(r.linkedinUrl, 300),
    hq: { city: s(o("hq").city, 80), country: s(o("hq").country, 60) },
    aum: { amount: n(o("aum").amount), currency: s(o("aum").currency, 5) || "USD", asOf: s(o("aum").asOf, 40), source: s(o("aum").source, 300) },
    ticket: { min: n(o("ticket").min), max: n(o("ticket").max), currency: s(o("ticket").currency, 5) || "USD", note: s(o("ticket").note, 300) },
    investsIn: arr(r.investsIn, x => s(x as unknown, 120)).filter(Boolean),
    sectors: arr(r.sectors, x => s(x as unknown, 80)).filter(Boolean),
    geographies: arr(r.geographies, x => s(x as unknown, 80)).filter(Boolean),
    lpActivity: arr(r.lpActivity, x => ({ fund: s(x.fund, 160), manager: s(x.manager, 120), year: s(x.year, 10), amount: s(x.amount, 60), source: s(x.source, 300) }), 30),
    directInvestments: arr(r.directInvestments, x => ({ company: s(x.company, 160), year: s(x.year, 10), note: s(x.note, 200), source: s(x.source, 300) }), 30),
    people: arr(r.people, x => ({ name: s(x.name, 120), title: s(x.title, 120), email: s(x.email, 160), phone: s(x.phone, 60), linkedinUrl: s(x.linkedinUrl, 300), source: s(x.source, 300) }), 15).filter(p => p.name),
    fit: pct(r.fit), probability: pct(r.probability),
    rationale: arr(r.rationale, x => s(x as unknown, 400)).filter(Boolean),
    strengths: arr(r.strengths, x => s(x as unknown, 300)).filter(Boolean),
    concerns: arr(r.concerns, x => s(x as unknown, 300)).filter(Boolean),
    approach: s(r.approach, 1500),
    sources: arr(r.sources, x => ({ title: s(x.title, 200), url: s(x.url, 500) }), 25).filter(x => x.url),
  };
}

/** Runs the research for one investor and saves it (meant to run in the background). */
export async function researchInvestor(id: string, apiKey: string) {
  const [inv] = await db.select().from(investors).where(eq(investors.id, id)).limit(1);
  if (!inv) return;
  try {
    const [contacts, settings, thesis] = await Promise.all([
      db.select().from(investorContacts).where(eq(investorContacts.investorId, id)),
      db.select({ fundTarget: firmSettings.fundTarget, fundCurrency: firmSettings.fundCurrency, fundName: firmSettings.fundName })
        .from(firmSettings).where(eq(firmSettings.id, FIRM_SETTINGS_ID)).limit(1),
      getFirmThesis(),
    ]);
    const fund = settings[0];
    const context = [
      `PANDO'S FUND: ${fund?.fundName ?? "Pando's fund"}${fund?.fundTarget ? `, target size ${fund.fundCurrency ?? "USD"} ${fund.fundTarget.toLocaleString("en-US")}` : ""}.`,
      `PANDO'S THESIS:\n${thesis.slice(0, 6000)}`,
      `THE INVESTOR TO RESEARCH: ${inv.name}`,
      [inv.website && `Website: ${inv.website}`, inv.country && `Country: ${[inv.city, inv.country].filter(Boolean).join(", ")}`,
        `Type in our CRM: ${inv.type}`, `Stage in Pando's pipeline: ${investorStageInfo(inv.stage).label}`,
        inv.targetAmount && `Ticket we hope for: ${inv.currency} ${inv.targetAmount.toLocaleString("en-US")}`,
        inv.committedAmount && `Committed: ${inv.currency} ${inv.committedAmount.toLocaleString("en-US")}`,
        inv.nextStep && `Next step: ${inv.nextStep}${inv.nextStepDate ? ` (${inv.nextStepDate})` : ""}`,
        inv.focus && `Focus noted: ${inv.focus}`, inv.notes && `Team notes: ${inv.notes.slice(0, 2000)}`,
        contacts.length && `People we know there: ${contacts.map(c => `${c.name}${c.role ? ` (${c.role})` : ""}`).join(", ")}`,
      ].filter(Boolean).join("\n"),
    ].join("\n\n");

    const client = new Anthropic({ apiKey });
    const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }] as unknown as Anthropic.Messages.ToolUnion[];
    const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: context }];
    let msg = await client.messages.create({ model: MODEL, max_tokens: 16000, system: SYSTEM, tools, messages, output_config: { effort: "medium" } });
    // Long searches pause; send the turn back so the server continues it.
    for (let i = 0; msg.stop_reason === "pause_turn" && i < 4; i++) {
      messages.push({ role: "assistant", content: msg.content as unknown as Anthropic.Messages.ContentBlockParam[] });
      msg = await client.messages.create({ model: MODEL, max_tokens: 16000, system: SYSTEM, tools, messages, output_config: { effort: "medium" } });
      messages.pop();
    }
    if (msg.stop_reason === "refusal") throw new Error("The model declined this research. Try again or fill it in by hand.");
    const text = msg.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("The research came back without results. Try again.");
    const research = normalizeResearch(JSON.parse(text.slice(start, end + 1)));

    // Fill the profile where it's empty; the team's own values are never overwritten.
    const t = new Date().toISOString();
    const set: Partial<typeof investors.$inferInsert> = {
      research: JSON.stringify(research), researchStatus: "done", researchError: null, researchedAt: t, updatedAt: t,
    };
    if (inv.scoreSource !== "manual") {
      set.fitScore = research.fit; set.probability = research.probability; set.scoreSource = "ai"; set.scoredAt = t;
    } else {
      // Scores set by hand stay; the AI only fills the ones still empty.
      if (inv.fitScore == null) set.fitScore = research.fit;
      if (inv.probability == null) set.probability = research.probability;
    }
    if (!inv.website && research.website) set.website = research.website;
    if (!inv.linkedinUrl && research.linkedinUrl) set.linkedinUrl = research.linkedinUrl;
    if (!inv.description && research.summary) set.description = research.summary;
    if (!inv.aum && research.aum.amount) set.aum = research.aum.amount;
    if (!inv.focus && research.investsIn.length) set.focus = [...research.investsIn, ...research.sectors].slice(0, 10).join(", ");
    if (!inv.geographies && research.geographies.length) set.geographies = research.geographies.join(", ");
    if (!inv.ticketMin && research.ticket.min) set.ticketMin = research.ticket.min;
    if (!inv.ticketMax && research.ticket.max) set.ticketMax = research.ticket.max;
    if (!inv.city && research.hq.city) set.city = research.hq.city;
    if (!inv.country && research.hq.country) set.country = research.hq.country;
    await db.update(investors).set(set).where(eq(investors.id, id));
  } catch (err) {
    console.error("[investor research]", id, err);
    await db.update(investors).set({
      researchStatus: "error", researchError: (err instanceof Error ? err.message : "The research failed").slice(0, 400),
    }).where(eq(investors.id, id));
  }
}

/** Adds a person the research found as a contact. */
export async function addResearchedContact(investorId: string, p: InvestorResearch["people"][number]) {
  const t = new Date().toISOString();
  const id = randomUUID();
  await db.insert(investorContacts).values({
    id, investorId, name: p.name, role: p.title || null, email: p.email || null, phone: p.phone || null,
    linkedinUrl: p.linkedinUrl || null, notes: p.source ? `Found by AI research: ${p.source}` : "Found by AI research",
    isPrimary: false, source: "ai", createdAt: t, updatedAt: t,
  });
  return id;
}
