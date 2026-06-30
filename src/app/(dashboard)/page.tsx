import { Topbar } from "@/components/layout/Topbar";
import { KpiCard, Card, SectionHeader } from "@/components/ui/Card";
import { SignalBadge, StatusBadge, ScoreBadge } from "@/components/ui/Badge";
import { Spark } from "@/components/charts/Spark";
import { Donut } from "@/components/charts/Donut";
import { DailyDigest } from "@/components/dashboard/DailyDigest";
import { db } from "@/lib/db";
import { desc, gte, lte, and } from "drizzle-orm";
import { fmtDate, fmtM } from "@/lib/utils";
import Link from "next/link";
import type { SignalType } from "@/types";
import * as schema from "@/lib/schema";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const ACTION_LABELS: Record<string, string> = {
  added_company:      "added company",
  edited_company:     "edited company",
  added_mandate:      "created mandate",
  edited_mandate:     "edited mandate",
  uploaded_template:  "uploaded template",
  generated_document: "generated document",
};

export const revalidate = 0;

async function getDashboardData() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [allCompanies, allSignals, allMandates, allSources, recentActivity, todayCronLogs] = await Promise.all([
    db.query.companies.findMany({
      with: { signals: { limit: 2, orderBy: (s, { desc }) => [desc(s.date)] } },
      orderBy: [desc(schema.companies.score)],
    }),
    db.query.signals.findMany({
      orderBy: [desc(schema.signals.date)],
      limit: 8,
      with: { company: true },
    }),
    db.query.mandates.findMany({
      where: (m, { eq }) => eq(m.isActive, true),
    }),
    db.query.dataSources.findMany({
      where: (s, { eq }) => eq(s.isEnabled, true),
    }),
    db.query.activityLog.findMany({
      orderBy: [desc(schema.activityLog.createdAt)],
      limit: 12,
    }),
    db.query.cronLogs.findMany({
      where: and(
        gte(schema.cronLogs.ranAt, todayStart.toISOString()),
        lte(schema.cronLogs.ranAt, todayEnd.toISOString()),
      ),
      orderBy: [desc(schema.cronLogs.ranAt)],
    }).catch(() => []),
  ]);
  return { companies: allCompanies, signals: allSignals, mandates: allMandates, sources: allSources, activity: recentActivity, cronLogs: todayCronLogs };
}

export default async function DashboardPage() {
  const { companies, signals, mandates, sources, activity, cronLogs } = await getDashboardData();

  const pipeline = companies.filter((c) => c.status === "pipeline");
  const monitoring = companies.filter((c) => c.status === "monitoring");
  const highSignals = signals.filter((s) => s.severity === "high");

  const statusDist = [
    { label: "Monitoring", value: monitoring.length, color: "#D9DBD4" },
    { label: "Pipeline",   value: pipeline.length,   color: "#0A231F" },
    { label: "Portfolio",  value: companies.filter(c => c.status === "portfolio").length, color: "#059669" },
  ].filter((s) => s.value > 0);

  return (
    <div>
      <Topbar title="Dashboard" subtitle={`${new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`} />

      <div className="p-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard label="Companies monitored" value={companies.length} delta={8} accent />
          <KpiCard label="Active pipeline" value={pipeline.length} sub={`${mandates.length} active mandates`} />
          <KpiCard label="Signals this week" value={signals.length} delta={signals.length > 5 ? 22 : -5} sub={`${highSignals.length} high priority`} />
          <KpiCard label="Active connectors" value={sources.length} sub="of 15 available" />
        </div>

        {/* Daily digest */}
        <DailyDigest logs={cronLogs as any} />

        {/* Row 2 */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="col-span-2" padding="none">
            <div className="p-5 border-b border-chalk">
              <SectionHeader title="Recent signals" subtitle="Activity requiring attention"
                action={<Link href="/radar" className="text-[11px] text-slate hover:text-carbon font-medium transition-colors">View radar →</Link>}
                className="mb-0" />
            </div>
            <div className="divide-y divide-chalk">
              {signals.slice(0, 6).map((sig) => (
                <div key={sig.id} className="flex items-start gap-3 px-5 py-3 hover:bg-fog/50 transition-colors">
                  <div className="pt-0.5 flex-none">
                    <SignalBadge type={sig.type as SignalType} severity={sig.severity} compact />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/empresa/${sig.company.slug}`} className="text-[12px] font-medium text-carbon hover:text-orange transition-colors">
                      {sig.company.name}
                    </Link>
                    <p className="text-[12px] text-graphite truncate">{sig.title}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    <SignalBadge type={sig.type as SignalType} severity={sig.severity} />
                    <span className="text-[10px] text-slate">{fmtDate(sig.date)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            <Card padding="sm">
              <SectionHeader title="Pipeline" subtitle={`${pipeline.length} empresas`} className="mb-3" />
              <div className="flex items-center justify-between">
                <Donut segments={statusDist} size={80} thickness={14} centerLabel={companies.length.toString()} centerSub="total" />
                <div className="space-y-1.5 text-[11px]">
                  {statusDist.map((s) => (
                    <div key={s.label} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-none" style={{ background: s.color }} />
                      <span className="text-graphite">{s.label}</span>
                      <span className="font-semibold text-carbon ml-auto pl-2">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
            <Card padding="none" className="flex flex-col">
              <div className="px-4 pt-4 pb-3 border-b border-chalk flex-none">
                <SectionHeader title="Recent activity" subtitle="Team changes" className="mb-0" />
              </div>
              <div className="divide-y divide-chalk overflow-y-auto" style={{ maxHeight: 220 }}>
                {activity.length === 0 ? (
                  <p className="text-[11px] text-slate px-4 py-3">No activity recorded</p>
                ) : activity.map((a) => (
                  <div key={a.id} className="px-4 py-2.5 hover:bg-fog/40 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[11px] font-medium text-carbon">{a.userName.split(" ")[0]}</span>
                        <span className="text-[11px] text-slate"> {ACTION_LABELS[a.action] ?? a.action}</span>
                        {a.entityName && <span className="text-[11px] text-graphite font-medium"> · {a.entityName}</span>}
                      </div>
                      <span className="text-[10px] text-slate flex-none">{timeAgo(a.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* Company table */}
        <Card padding="none">
          <div className="p-5 border-b border-chalk">
            <SectionHeader title="Top companies by score" subtitle="Sorted by relevance for active mandates"
              action={<Link href="/radar" className="text-[11px] text-slate hover:text-carbon font-medium transition-colors">View all →</Link>}
              className="mb-0" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[10px] text-slate uppercase tracking-wide border-b border-chalk">
                  <th className="px-5 py-2.5 text-left font-medium">Company</th>
                  <th className="px-3 py-2.5 text-left font-medium">Sector</th>
                  <th className="px-3 py-2.5 text-left font-medium">Country</th>
                  <th className="px-3 py-2.5 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2.5 text-right font-medium">Growth</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Score</th>
                  <th className="px-3 py-2.5 text-left font-medium">Signals</th>
                  <th className="px-3 py-2.5 text-center font-medium">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-chalk">
                {companies.slice(0, 8).map((c) => {
                  const topSig = c.signals[0];
                  return (
                    <tr key={c.id} className="hover:bg-fog/40 transition-colors">
                      <td className="px-5 py-3">
                        <Link href={`/empresa/${c.slug}`} className="font-medium text-[13px] text-carbon hover:text-orange transition-colors">{c.name}</Link>
                        <p className="text-[10px] text-slate">{c.stage ?? "—"}</p>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-graphite">{c.sector ?? "—"}</td>
                      <td className="px-3 py-3 text-[12px] text-graphite">{c.country}</td>
                      <td className="px-3 py-3 text-[12px] text-carbon text-right font-medium">{fmtM(c.revenueUsd)}</td>
                      <td className="px-3 py-3 text-[12px] text-right">
                        {c.revenueGrowth != null ? (
                          <span className={c.revenueGrowth >= 0 ? "text-emerald-600" : "text-red-500"}>
                            {c.revenueGrowth > 0 ? "+" : ""}{c.revenueGrowth}%
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-3 py-3 text-right"><ScoreBadge score={c.score} /></td>
                      <td className="px-3 py-3">
                        {topSig && <SignalBadge type={topSig.type as SignalType} severity={topSig.severity} />}
                      </td>
                      <td className="px-3 py-3 flex justify-center">
                        <Spark values={[50, 55, 58, 60, 63, 65, 68, c.score]} width={60} height={24} color={c.score >= 85 ? "#059669" : "#004F46"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
