import { Topbar } from "@/components/layout/Topbar";
import { KpiCard, Card, SectionHeader } from "@/components/ui/Card";
import { SignalBadge, StatusBadge, ScoreBadge } from "@/components/ui/Badge";
import { Spark } from "@/components/charts/Spark";
import { VBars } from "@/components/charts/VBars";
import { Donut } from "@/components/charts/Donut";
import { db } from "@/lib/db";
import { desc, asc } from "drizzle-orm";
import { fmtDate, fmtM } from "@/lib/utils";
import Link from "next/link";
import type { SignalType } from "@/types";
import * as schema from "@/lib/schema";

export const revalidate = 0;

async function getDashboardData() {
  const [allCompanies, allSignals, allMandates, allSources] = await Promise.all([
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
  ]);
  return { companies: allCompanies, signals: allSignals, mandates: allMandates, sources: allSources };
}

export default async function DashboardPage() {
  const { companies, signals, mandates, sources } = await getDashboardData();

  const pipeline = companies.filter((c) => c.status === "pipeline");
  const monitoring = companies.filter((c) => c.status === "monitoring");
  const highSignals = signals.filter((s) => s.severity === "high");

  const statusDist = [
    { label: "Monitoreando", value: monitoring.length, color: "#e8e8e8" },
    { label: "Pipeline",     value: pipeline.length,   color: "#202020" },
    { label: "Portafolio",   value: companies.filter(c => c.status === "portfolio").length, color: "#059669" },
  ].filter((s) => s.value > 0);

  const trend = [2, 3, 5, 4, 7, 6, 8, 9, 8, 11, 10, 12];
  const months = ["E","F","M","A","M","J","J","A","S","O","N","D"];

  return (
    <div>
      <Topbar title="Dashboard" subtitle={`${new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`} />

      <div className="p-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard label="Empresas monitoreadas" value={companies.length} delta={8} accent />
          <KpiCard label="En pipeline activo" value={pipeline.length} sub={`${mandates.length} mandatos activos`} />
          <KpiCard label="Señales esta semana" value={signals.length} delta={signals.length > 5 ? 22 : -5} sub={`${highSignals.length} alta prioridad`} />
          <KpiCard label="Conectores activos" value={sources.length} sub="de 15 disponibles" />
        </div>

        {/* Row 2 */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="col-span-2" padding="none">
            <div className="p-5 border-b border-chalk">
              <SectionHeader title="Señales recientes" subtitle="Actividad que requiere atención"
                action={<Link href="/radar" className="text-[11px] text-slate hover:text-carbon font-medium transition-colors">Ver radar →</Link>}
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
            <Card padding="sm">
              <SectionHeader title="Actividad" subtitle="Empresas agregadas / mes" className="mb-2" />
              <VBars labels={months} values={trend} width={168} height={80} color="#202020" />
            </Card>
          </div>
        </div>

        {/* Company table */}
        <Card padding="none">
          <div className="p-5 border-b border-chalk">
            <SectionHeader title="Top empresas por score" subtitle="Ordenadas por relevancia para mandatos activos"
              action={<Link href="/radar" className="text-[11px] text-slate hover:text-carbon font-medium transition-colors">Ver todas →</Link>}
              className="mb-0" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[10px] text-slate uppercase tracking-wide border-b border-chalk">
                  <th className="px-5 py-2.5 text-left font-medium">Empresa</th>
                  <th className="px-3 py-2.5 text-left font-medium">Sector</th>
                  <th className="px-3 py-2.5 text-left font-medium">País</th>
                  <th className="px-3 py-2.5 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2.5 text-right font-medium">Crec.</th>
                  <th className="px-3 py-2.5 text-left font-medium">Estado</th>
                  <th className="px-3 py-2.5 text-right font-medium">Score</th>
                  <th className="px-3 py-2.5 text-left font-medium">Señales</th>
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
                        <Spark values={[50, 55, 58, 60, 63, 65, 68, c.score]} width={60} height={24} color={c.score >= 85 ? "#059669" : "#ff682c"} />
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
