import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Badge, SignalBadge } from "@/components/ui/Badge";
import { MarkReadOnMount } from "@/components/signals/MarkReadOnMount";
import { WebsiteLink } from "@/components/ui/WebsiteLink";
import { IconTrendingUp, IconMerge, IconXCircle, IconBell, IconFlag } from "@/components/ui/Icons";
import { db } from "@/lib/db";
import { desc, inArray } from "drizzle-orm";
import * as schema from "@/lib/schema";
import { fmtM, fmtDate } from "@/lib/utils";
import Link from "next/link";
import type { SignalType } from "@/types";

export const revalidate = 0;

const EXIT_LABEL: Record<string, { label: string; color: string; iconCls: string }> = {
  public:   { label: "IPO",               color: "text-emerald-700 bg-emerald-50 border-emerald-200", iconCls: "text-emerald-600" },
  acquired: { label: "Acquired",           color: "text-blue-700 bg-blue-50 border-blue-200",         iconCls: "text-blue-600" },
  closed:   { label: "Ceased Operations",  color: "text-red-700 bg-red-50 border-red-200",             iconCls: "text-red-500" },
};

const EXIT_ICON = {
  public:   IconTrendingUp,
  acquired: IconMerge,
  closed:   IconXCircle,
} as const;

// Estimated EV multiple by sector (revenue multiple)
const SECTOR_MULTIPLE: Record<string, number> = {
  Fintech: 5.5, SaaS: 7.0, Software: 6.5, Logistics: 3.0, Healthtech: 5.0,
  Edtech: 4.0, Proptech: 3.5, Agtech: 3.0, Marketplace: 4.0, Mobility: 3.5,
};

function getMultiple(sector: string | null): number {
  if (!sector) return 4.0;
  return SECTOR_MULTIPLE[sector] ?? 4.0;
}

export default async function ExitPage() {
  // Real exited companies from DB
  const exitedCompanies = await db.query.companies.findMany({
    where: (c, { inArray }) => inArray(c.status, ["public", "acquired", "closed"]),
    with: {
      signals: {
        orderBy: (s, { desc }) => [desc(s.date)],
        limit: 3,
      },
    },
    orderBy: [desc(schema.companies.score)],
  });

  // Pipeline companies that have exit-related signals (potential exits pending confirmation)
  const exitAlerts = await db.query.companies.findMany({
    where: (c, { eq }) => eq(c.status, "pipeline"),
    with: {
      signals: {
        where: (s, { inArray }) => inArray(s.type, ["exit_signal", "strategic_buyer_interest", "exit_rumor"]),
        orderBy: (s, { desc }) => [desc(s.date)],
        limit: 1,
      },
    },
  }).then(cos => cos.filter(c => c.signals.length > 0));

  const totalExits   = exitedCompanies.length;
  const ipos         = exitedCompanies.filter(c => c.status === "public").length;
  const acquisitions = exitedCompanies.filter(c => c.status === "acquired").length;
  const closures     = exitedCompanies.filter(c => c.status === "closed").length;

  const totalRevExited = exitedCompanies
    .filter(c => c.revenueUsd)
    .reduce((s, c) => s + (c.revenueUsd ?? 0), 0);

  return (
    <div>
      <MarkReadOnMount types={["exit_signal"]} />
      <Topbar
        title="Exits"
        subtitle={`${totalExits} confirmed exit${totalExits !== 1 ? "s" : ""} · ${exitAlerts.length} signal${exitAlerts.length !== 1 ? "s" : ""} pending confirmation`}
      />
      <div className="p-6 space-y-5">

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total exits",     value: totalExits,   sub: "confirmed",              color: "text-carbon" },
            { label: "IPOs",            value: ipos,         sub: "public listings",         color: "text-emerald-700" },
            { label: "Acquisitions",    value: acquisitions, sub: "M&A closed",              color: "text-blue-700" },
            { label: "Closures",        value: closures,     sub: "closed operations",       color: "text-red-600" },
          ].map(stat => (
            <Card key={stat.label} padding="sm">
              <div className={`text-[26px] font-bold font-poly ${stat.color}`}>{stat.value}</div>
              <div className="text-[11px] font-medium text-carbon mt-0.5">{stat.label}</div>
              <div className="text-[10px] text-slate">{stat.sub}</div>
            </Card>
          ))}
        </div>

        {/* Pending exit alerts from cron */}
        {exitAlerts.length > 0 && (
          <Card>
            <SectionHeader
              title="Exit signals pending confirmation"
              subtitle="The cron job detected potential exit events. Review and confirm manually from the Pipeline."
              className="mb-3"
            />
            <div className="space-y-2">
              {exitAlerts.map(c => {
                const sig = c.signals[0];
                return (
                  <div key={c.id} className="flex items-center gap-4 p-3 bg-amber-50 border border-amber-200 rounded-[9px]">
                    <IconBell size={18} className="text-amber-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link href={`/empresa/${c.slug}`} className="text-[13px] font-semibold text-carbon hover:text-orange transition-colors">
                          {c.name}
                        </Link>
                        <span className="text-[10px] text-slate">{c.sector} · {c.country}</span>
                      </div>
                      {sig && <p className="text-[11px] text-graphite mt-0.5">{sig.title}</p>}
                    </div>
                    <Link href="/radar"
                      className="shrink-0 px-3 py-1.5 text-[11px] font-medium bg-amber-600 text-white rounded-[7px] hover:bg-amber-700 transition-colors">
                      Go to Pipeline →
                    </Link>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Exited companies */}
        {exitedCompanies.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center justify-center h-48 text-slate">
              <IconFlag size={44} className="text-chalk mb-3" />
              <p className="text-[15px] font-semibold text-carbon">No exits recorded yet</p>
              <p className="text-[12px] mt-2 text-center max-w-[300px]">
                When a company in the Pipeline completes an exit (IPO, acquisition, or closure), it will appear here with full details.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <h2 className="text-[12px] font-semibold text-graphite uppercase tracking-wide px-1">Confirmed exits</h2>
            {exitedCompanies.map(c => {
              const exitInfo = EXIT_LABEL[c.status] ?? EXIT_LABEL.closed;
              const multiple = getMultiple(c.sector);
              const estEV = c.revenueUsd ? c.revenueUsd * multiple : null;
              // Use earliest exit-related signal date as "exit date"
              const exitSignal = c.signals.find(s =>
                ["exit_signal", "strategic_buyer_interest", "exit_rumor"].includes(s.type)
              );
              const exitDate = exitSignal?.date ?? c.signals[0]?.date ?? null;

              const ExitIcon = EXIT_ICON[c.status as keyof typeof EXIT_ICON] ?? IconFlag;
              return (
                <Card key={c.id}>
                  <div className="flex items-start gap-4">
                    {/* Exit type icon */}
                    <div className={`shrink-0 w-11 h-11 rounded-[10px] border flex items-center justify-center ${exitInfo.color}`}>
                      <ExitIcon size={22} className={exitInfo.iconCls} />
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link href={`/empresa/${c.slug}`} className="text-[15px] font-semibold text-carbon hover:text-orange transition-colors">
                              {c.name}
                            </Link>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${exitInfo.color}`}>
                              {exitInfo.label}
                            </span>
                            <WebsiteLink url={c.website} />
                            {exitDate && (
                              <span className="text-[10px] text-slate">
                                Detected: {fmtDate(exitDate)}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate mt-0.5">{c.sector ?? "—"} · {c.country}</div>
                        </div>

                        {/* Financials */}
                        <div className="flex gap-4 text-center shrink-0">
                          <div>
                            <div className="text-[15px] font-bold text-carbon font-poly">{fmtM(c.revenueUsd)}</div>
                            <div className="text-[9px] text-slate">Revenue</div>
                          </div>
                          {estEV && (
                            <div>
                              <div className="text-[15px] font-bold text-carbon font-poly">{fmtM(estEV)}</div>
                              <div className="text-[9px] text-slate">Est. EV ({multiple}x)</div>
                            </div>
                          )}
                          {c.totalFunding && (
                            <div>
                              <div className="text-[15px] font-bold text-carbon font-poly">{fmtM(c.totalFunding)}</div>
                              <div className="text-[9px] text-slate">Total funding</div>
                            </div>
                          )}
                        </div>
                      </div>

                      {c.description && (
                        <p className="text-[11px] text-graphite leading-relaxed mb-2 max-w-2xl">{c.description.slice(0, 200)}</p>
                      )}

                      {/* Signals */}
                      {c.signals.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {c.signals.slice(0, 3).map(sig => (
                            <div key={sig.id} className="flex items-center gap-1.5 bg-fog border border-chalk rounded-[6px] px-2 py-1">
                              <SignalBadge type={sig.type as SignalType} severity={sig.severity} compact />
                              <span className="text-[10px] text-graphite max-w-[200px] truncate">{sig.title}</span>
                              <span className="text-[9px] text-slate shrink-0">{fmtDate(sig.date)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Strategic buyers reference — clearly labeled as market reference */}
        <Card>
          <SectionHeader
            title="Reference strategic buyers in LATAM"
            subtitle="Funds and strategics active in LATAM tech acquisitions · Market reference"
            className="mb-3"
          />
          <div className="grid grid-cols-2 gap-2">
            {[
              { name: "Vista Equity Partners",  type: "PE",          focus: "Scalable B2B software",          region: "Global",       matchScore: 92 },
              { name: "Softbank LATAM Fund",    type: "VC/Growth",   focus: "Tech LATAM growth stage",         region: "LATAM",        matchScore: 88 },
              { name: "General Atlantic",       type: "PE",          focus: "Global growth equity tech",       region: "Global",       matchScore: 85 },
              { name: "Advent International",   type: "PE",          focus: "Tech & financial services",       region: "LATAM/Global", matchScore: 81 },
              { name: "Patria Investments",     type: "PE",          focus: "Multi-sector LATAM",             region: "LATAM",        matchScore: 79 },
              { name: "Warburg Pincus",         type: "PE",          focus: "Growth tech, fintech",            region: "Global",       matchScore: 76 },
            ].map(buyer => (
              <div key={buyer.name} className="flex items-center gap-3 py-2.5 px-3 border border-chalk rounded-[8px] bg-fog/40">
                <div className="w-7 h-7 rounded-[6px] bg-carbon flex items-center justify-center text-white text-[9px] font-bold flex-none">
                  {buyer.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-carbon">{buyer.name}</div>
                  <div className="text-[10px] text-slate truncate">{buyer.focus} · {buyer.region}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge variant={buyer.type === "PE" ? "carbon" : "blue"}>{buyer.type}</Badge>
                  <span className="text-[12px] font-bold" style={{ color: buyer.matchScore >= 85 ? "#059669" : buyer.matchScore >= 75 ? "#d97706" : "#828282" }}>
                    {buyer.matchScore}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate mt-3 italic">
            Match scores are internal estimates based on each fund's published thesis. They do not represent confirmed interest.
          </p>
        </Card>

      </div>
    </div>
  );
}
