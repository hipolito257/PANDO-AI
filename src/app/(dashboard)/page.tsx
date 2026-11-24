// General › Overview: the whole firm at a glance, one entry per section.
import Link from "next/link";
import { and, asc, desc, eq, gte, isNotNull, lte, ne } from "drizzle-orm";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { auth } from "@/lib/auth";
import { db, deals, dealStages, dealTasks, dealMilestones, investors, firmSettings, activityLog, users } from "@/lib/db";
import { FIRM_SETTINGS_ID } from "@/lib/firmThesis";
import { fmtMoney } from "@/lib/fundraising";

export const revalidate = 0;

function ago(iso: string | null) {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d < 1 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function OverviewPage() {
  const session = await auth();
  const me = session?.user?.id ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [allDeals, stages, invRows, settings, myTasks, milestones, activity, team] = await Promise.all([
    db.select({ id: deals.id, phase: deals.phase, stage: deals.stage, dealSize: deals.dealSize, currency: deals.currency }).from(deals),
    db.select().from(dealStages),
    db.select({ stage: investors.stage, committed: investors.committedAmount, target: investors.targetAmount, currency: investors.currency }).from(investors),
    db.select({ target: firmSettings.fundTarget, currency: firmSettings.fundCurrency, name: firmSettings.fundName }).from(firmSettings).where(eq(firmSettings.id, FIRM_SETTINGS_ID)).limit(1),
    me ? db.query.dealTasks.findMany({
      where: and(eq(dealTasks.assigneeId, me), ne(dealTasks.status, "done")),
      with: { deal: { columns: { id: true, codeName: true } } },
      orderBy: [asc(dealTasks.dueDate)], limit: 6,
    }) : Promise.resolve([]),
    db.query.dealMilestones.findMany({
      where: and(eq(dealMilestones.done, false), isNotNull(dealMilestones.date), gte(dealMilestones.date, today), lte(dealMilestones.date, in30)),
      with: { deal: { columns: { id: true, codeName: true } } },
      orderBy: [asc(dealMilestones.date)], limit: 6,
    }),
    db.select().from(activityLog).orderBy(desc(activityLog.createdAt)).limit(8),
    db.select({ id: users.id }).from(users).where(eq(users.status, "active")),
  ]);

  const kind = new Map(stages.map(s => [s.key, s.kind]));
  const open = (phase: string) => allDeals.filter(d => d.phase === phase && kind.get(d.stage) !== "lost" && (phase !== "exit" || kind.get(d.stage) !== "won"));
  const sourcing = open("sourcing").filter(d => kind.get(d.stage) === "open");
  const portfolio = open("portfolio");
  const exits = open("exit");
  const realized = allDeals.filter(d => d.phase === "exit" && kind.get(d.stage) === "won");

  const fund = settings[0];
  const currency = fund?.currency ?? "USD";
  const committed = invRows.filter(r => r.stage === "committed").reduce((n, r) => n + (r.committed ?? 0), 0);
  const softCommit = invRows.filter(r => r.stage === "soft_commit").reduce((n, r) => n + (r.committed ?? r.target ?? 0), 0);
  const activeLps = invRows.filter(r => !["committed", "declined"].includes(r.stage)).length;
  const pct = fund?.target ? Math.min(100, (committed / fund.target) * 100) : null;
  const firstName = (session?.user?.name ?? "").split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 19 ? "Good afternoon" : "Good evening";

  const sections = [
    { href: "/fundraising", eyebrow: "Fundraising", value: fmtMoney(committed, currency), label: fund?.target ? `committed of ${fmtMoney(fund.target, currency)} target` : "committed", sub: `${activeLps} investor${activeLps === 1 ? "" : "s"} in conversation` },
    { href: "/deals", eyebrow: "Deal Sourcing", value: String(sourcing.length), label: `active deal${sourcing.length === 1 ? "" : "s"} in the pipeline`, sub: "Radar, mandates, comps and documents" },
    { href: "/portfolio", eyebrow: "Portfolio", value: String(portfolio.length), label: `portfolio compan${portfolio.length === 1 ? "y" : "ies"}`, sub: "Value creation and monitoring" },
    { href: "/exits", eyebrow: "Exit", value: String(exits.length), label: `exit${exits.length === 1 ? "" : "s"} in progress`, sub: `${realized.length} realized` },
  ];

  return (
    <div>
      <Topbar title="Overview" subtitle={new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
      <div className="p-6 space-y-6">
        <div data-reveal className="pt-2">
          <p className="eyebrow">Pando · {team.length} people</p>
          <h2 className="mt-3 font-display text-[clamp(1.7rem,3.2vw,2.6rem)] font-light leading-[1.08] text-carbon">
            {greet}{firstName ? `, ` : ""}<b className="font-semibold">{firstName}</b>
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {sections.map(s => (
            <Link key={s.href} href={s.href} data-reveal className="group block bg-paper shadow-card p-5 hover:bg-olive transition-colors duration-500">
              <p className="eyebrow group-hover:!text-pistacho">{s.eyebrow}</p>
              <p className="mt-4 font-display text-[34px] font-light leading-none text-carbon group-hover:text-white">{s.value}</p>
              <p className="mt-2 text-[12px] text-graphite group-hover:text-white/70">{s.label}</p>
              <p className="mt-4 pt-3 border-t border-chalk group-hover:border-white/15 text-[11px] text-slate group-hover:text-white/55 flex items-center justify-between">
                {s.sub}<span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </p>
            </Link>
          ))}
        </div>

        {pct !== null && (
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <p className="eyebrow">{fund?.name ?? "Fund"} · fundraising progress</p>
              <p className="text-[12px] text-graphite">{fmtMoney(committed, currency)} committed · {fmtMoney(softCommit, currency)} soft commits · target {fmtMoney(fund!.target, currency)}</p>
            </div>
            <div className="h-2 bg-fog relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-olive" style={{ width: `${pct}%` }} />
              <div className="absolute inset-y-0 bg-pistacho" style={{ left: `${pct}%`, width: `${Math.min(100 - pct, fund?.target ? (softCommit / fund.target) * 100 : 0)}%` }} />
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <SectionHeader title="My open tasks" subtitle="Assigned to you, soonest first" />
            {myTasks.length === 0 ? <p className="text-[12px] text-slate">Nothing assigned to you.</p> : (
              <div className="divide-y divide-chalk">
                {myTasks.map(t => (
                  <Link key={t.id} href={`/deals/${t.deal.id}`} className="flex items-start justify-between gap-3 py-2 hover:bg-fog/60 -mx-2 px-2">
                    <span className="text-[12px] text-carbon">{t.title}<span className="block text-[10px] text-slate">{t.deal.codeName}</span></span>
                    {t.dueDate && <span className={`text-[11px] shrink-0 ${t.dueDate < today ? "text-red-600 font-medium" : "text-slate"}`}>{fmtDay(t.dueDate)}</span>}
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <SectionHeader title="Next 30 days" subtitle="Milestones across every deal" />
            {milestones.length === 0 ? <p className="text-[12px] text-slate">No milestones in the next 30 days.</p> : (
              <div className="divide-y divide-chalk">
                {milestones.map(m => (
                  <Link key={m.id} href={`/deals/${m.deal.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-fog/60 -mx-2 px-2">
                    <span className="text-[12px] text-carbon">{m.label}<span className="block text-[10px] text-slate">{m.deal.codeName}</span></span>
                    <span className="text-[11px] text-slate shrink-0">{fmtDay(m.date!)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <SectionHeader title="Recent activity" subtitle="What the team did" />
            {activity.length === 0 ? <p className="text-[12px] text-slate">Nothing yet.</p> : (
              <div className="space-y-2">
                {activity.map(a => (
                  <p key={a.id} className="text-[11px] text-graphite leading-snug">
                    <strong className="text-carbon font-medium">{a.userName}</strong> {a.action.replace(/_/g, " ")}{a.entityName ? <> · <span className="text-carbon">{a.entityName}</span></> : null}
                    <span className="text-slate"> · {ago(a.createdAt)}</span>
                  </p>
                ))}
              </div>
            )}
          </Card>
        </div>

      </div>
    </div>
  );
}

