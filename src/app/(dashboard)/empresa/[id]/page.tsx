import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import * as schema from "@/lib/schema";
import { or, eq } from "drizzle-orm";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Badge, SignalBadge, StatusBadge, ScoreBadge } from "@/components/ui/Badge";
import { VBars } from "@/components/charts/VBars";
import { Donut } from "@/components/charts/Donut";
import { RadarChart } from "@/components/charts/RadarChart";
import { Spark } from "@/components/charts/Spark";
import { fmtM, fmtDate, fmtPct } from "@/lib/utils";
import Link from "next/link";
import type { SignalType } from "@/types";
import { EmpresaActions } from "@/components/company/EmpresaActions";
import { NotesPanel } from "@/components/company/NotesPanel";
import { NewsRefreshButton } from "@/components/company/NewsRefreshButton";
import { WebsiteLink } from "@/components/ui/WebsiteLink";
import { CompanyLogo } from "@/components/company/CompanyLogo";
import { CompanyHeroBg } from "@/components/company/CompanyHeroBg";

// Thin wrapper — keeps empresa page as a server component
function NotesSection({ companyId }: { companyId: string }) {
  return <NotesPanel companyId={companyId} />;
}

export const revalidate = 0;

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const company = await db.query.companies.findFirst({
    where: or(eq(schema.companies.id, id), eq(schema.companies.slug, id)),
    with: {
      signals:         { orderBy: (s, { desc }) => [desc(s.date)] },
      tags:            true,
      mandateMatches:  { with: { mandate: true }, orderBy: (m, { desc }) => [desc(m.score)] },
      newsItems:       { orderBy: (n, { desc }) => [desc(n.date)], limit: 6 },
      founders:        true,
      financialHistory:{ orderBy: (f, { asc })  => [asc(f.year)] },
    },
  });

  if (!company) notFound();

  const snapshots = (company.financialHistory ?? []).filter((s) => s.quarter === 0);
  const chartYears = snapshots.map((s) => s.year.toString());
  const chartRevenues = snapshots.map((s) => (s.revenueUsd ?? 0) / 1000);
  const chartEbitda = snapshots.map((s) => (s.ebitdaUsd ?? 0) / 1000);

  const capTable = [
    { label: "Founders",      value: 38, color: "#202020" },
    { label: "Series B",      value: 22, color: "#ff682c" },
    { label: "Series A",      value: 18, color: "#828282" },
    { label: "Seed / Angels", value: 14, color: "#e8e8e8" },
    { label: "ESOP",          value: 8,  color: "#d4cfc9" },
  ];

  const radarAxes = ["Market", "Product", "Team", "Finance", "Strategy", "Risk"];
  const radarVals = [85, 78, 90, 72, 80, 65];

  return (
    <div>
      <Topbar
        title={company.name}
        subtitle={`${company.sector ?? ""} · ${company.country}`}
        actions={
          <EmpresaActions company={company} />
        }
      />

      <div className="p-6 space-y-4">
        {/* Header */}
        <Card className="relative overflow-hidden">
          <CompanyHeroBg website={company.website} name={company.name} />
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <CompanyLogo name={company.name} website={company.website} size="lg" />
                <h2 className="text-[22px] font-semibold text-carbon tracking-tight font-poly">{company.name}</h2>
                <StatusBadge status={company.status} />
                <ScoreBadge score={company.score} />
                <WebsiteLink url={company.website} />
              </div>
              <p className="text-[13px] text-graphite max-w-2xl leading-relaxed mb-3">{company.description ?? "No description available."}</p>
              <div className="flex flex-wrap gap-1.5">
                {company.sector && <Badge variant="default">{company.sector}</Badge>}
                {company.subsector && <Badge variant="default">{company.subsector}</Badge>}
                <Badge variant="blue">{company.country}</Badge>
                {company.city && <Badge variant="default">{company.city}</Badge>}
                {company.stage && <Badge variant="yellow">{company.stage}</Badge>}
                {company.fundingStage && <Badge variant="orange">{company.fundingStage}</Badge>}
                {[...new Set(company.tags.map(t => t.tag))].map((tag) => <Badge key={tag} variant="default">{tag}</Badge>)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center shrink-0 ml-8">
              {[
                { label: "Revenue", value: fmtM(company.revenueUsd), sub: company.revenueGrowth != null ? `${fmtPct(company.revenueGrowth)} YoY` : null, positive: (company.revenueGrowth ?? 0) >= 0 },
                { label: "EBITDA", value: fmtM(company.ebitdaUsd), sub: company.ebitdaMargin != null ? `${company.ebitdaMargin.toFixed(1)}% margin` : null, positive: (company.ebitdaMargin ?? 0) >= 0 },
                { label: "Employees", value: company.employees?.toLocaleString("en-US") ?? "—", sub: company.employeeGrowth != null ? `${fmtPct(company.employeeGrowth)} YoY` : null, positive: (company.employeeGrowth ?? 0) >= 0 },
                { label: "Total funding", value: fmtM(company.totalFunding), sub: company.fundingStage, positive: true },
              ].map(({ label, value, sub, positive }) => (
                <div key={label} className="bg-fog rounded-[8px] p-3">
                  <div className="text-[18px] font-semibold text-carbon font-poly">{value}</div>
                  <div className="text-[10px] text-slate">{label}</div>
                  {sub && <div className={`text-[10px] font-medium ${positive ? "text-emerald-600" : "text-red-500"}`}>{sub}</div>}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Charts */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="col-span-2">
            <SectionHeader title="Financial History" subtitle="Revenue vs. EBITDA in $M USD" className="mb-3" />
            {chartYears.length > 1 ? (
              <>
                <VBars labels={chartYears} values={chartRevenues} line={chartEbitda} width={400} height={140} color="#202020" lineColor="#ff682c" />
                <div className="flex gap-4 mt-2 text-[10px]">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-carbon rounded inline-block" /> Revenue ($M)</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-orange inline-block" /> EBITDA ($M)</span>
                </div>
              </>
            ) : (
              <div className="h-32 flex items-center justify-center text-slate text-[12px]">No historical data</div>
            )}
          </Card>
          <Card>
            <SectionHeader title="Evaluation" subtitle="Score by dimension" className="mb-2" />
            <div className="flex justify-center">
              <RadarChart axes={radarAxes} values={radarVals} size={160} />
            </div>
          </Card>
        </div>

        {/* Signals + Cap Table */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="col-span-2">
            <SectionHeader title="Signals" subtitle={`${company.signals.length} signals detected`} className="mb-2" />
            {company.signals.length === 0 ? (
              <p className="text-[12px] text-slate py-4 text-center">No signals recorded</p>
            ) : (
              <div className="space-y-2">
                {company.signals.map((sig) => (
                  <div key={sig.id} className="flex items-start gap-3 p-3 bg-fog rounded-[8px]">
                    <SignalBadge type={sig.type as SignalType} severity={sig.severity} compact />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <SignalBadge type={sig.type as SignalType} severity={sig.severity} />
                        <span className="text-[10px] text-slate">{fmtDate(sig.date)}</span>
                      </div>
                      <p className="text-[12px] font-medium text-carbon mt-0.5">{sig.title}</p>
                      {sig.detail && <p className="text-[11px] text-graphite mt-0.5 leading-relaxed">{sig.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card>
              <SectionHeader title="Cap table" subtitle="Estimated distribution" className="mb-3" />
              <div className="flex items-center gap-4">
                <Donut segments={capTable} size={90} thickness={16} centerLabel="100%" centerSub="equity" />
                <div className="space-y-1.5 text-[10px] flex-1">
                  {capTable.map((s) => (
                    <div key={s.label} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-none" style={{ background: s.color }} />
                      <span className="text-graphite flex-1">{s.label}</span>
                      <span className="font-semibold text-carbon">{s.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
            {company.website && (
              <Card padding="sm">
                <SectionHeader title="Links" className="mb-2" />
                <a href={company.website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[12px] text-graphite hover:text-orange transition-colors py-1">
                  <span className="text-[10px] bg-fog border border-chalk rounded px-1.5 py-0.5">WEB</span>
                  {company.website.replace(/^https?:\/\//, "")}
                </a>
              </Card>
            )}
          </div>
        </div>

        {/* Founders + News */}
        <div className="grid grid-cols-2 gap-4">
          {company.founders.length > 0 && (
            <Card>
              <SectionHeader title="Founding team" className="mb-3" />
              <div className="space-y-3">
                {company.founders.map((f) => (
                  <div key={f.id} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-carbon flex items-center justify-center text-white text-[11px] font-semibold flex-none">
                      {f.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-carbon">{f.name}</span>
                        {f.title && <Badge variant="default">{f.title}</Badge>}
                      </div>
                      {f.bio && <p className="text-[11px] text-graphite mt-0.5 leading-relaxed">{f.bio}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between mb-2">
              <SectionHeader title="Recent news" className="mb-0" />
              <NewsRefreshButton companyId={company.id} />
            </div>
            {company.newsItems.length === 0 ? (
              <p className="text-[12px] text-slate py-4 text-center">No news recorded</p>
            ) : (
              <div className="space-y-2">
                {company.newsItems.map((news) => (
                  <div key={news.id} className="flex items-start gap-2 py-2 border-b border-chalk last:border-0">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-none ${news.sentiment === "positive" ? "bg-emerald-500" : news.sentiment === "negative" ? "bg-red-400" : "bg-slate-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-carbon leading-snug">{news.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {news.source && <span className="text-[10px] text-slate">{news.source}</span>}
                        <span className="text-[10px] text-slate">{fmtDate(news.date)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Internal Notes */}
        <Card>
          <SectionHeader title="Internal notes" subtitle="Visible only to the firm's team" className="mb-3" />
          <NotesSection companyId={company.id} />
        </Card>

        {/* Mandate matches */}
        {company.mandateMatches.length > 0 && (
          <Card>
            <SectionHeader title="Mandate matches" subtitle="Alignment with defined investment criteria" className="mb-3" />
            <div className="grid grid-cols-2 gap-3">
              {/* Deduplicate by mandateId — seed may have created duplicates */}
              {[...new Map(company.mandateMatches.map(mm => [mm.mandateId, mm])).values()].map((mm) => (
                <div key={mm.id} className="bg-fog rounded-[8px] p-3 border border-chalk">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] font-semibold text-carbon">{(mm as any).mandate.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={mm.tier === "strong" ? "green" : mm.tier === "candidate" ? "yellow" : "default"}>
                        {mm.tier === "strong" ? "Strong" : mm.tier === "candidate" ? "Candidate" : "Weak"}
                      </Badge>
                      <Spark values={[60, 65, 70, 75, mm.score]} width={40} height={16} color="#ff682c" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 bg-chalk rounded-full h-1.5">
                      <div className="bg-carbon rounded-full h-1.5 transition-all" style={{ width: `${mm.score}%` }} />
                    </div>
                    <span className="text-[11px] font-semibold text-carbon w-8">{mm.score}</span>
                  </div>
                  {mm.rationale && <p className="text-[11px] text-graphite leading-relaxed">{mm.rationale}</p>}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
