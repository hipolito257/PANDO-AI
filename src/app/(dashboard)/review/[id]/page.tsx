import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import * as schema from "@/lib/schema";
import { or, eq, desc, asc } from "drizzle-orm";
import { Topbar } from "@/components/layout/Topbar";
import { Badge, SignalBadge, StatusBadge } from "@/components/ui/Badge";
import { Spark } from "@/components/charts/Spark";
import { RadarChart } from "@/components/charts/RadarChart";
import { Logo } from "@/components/layout/Logo";
import { PrintButton } from "@/components/review/PrintButton";
import { fmtM, fmtDate, fmtPct } from "@/lib/utils";
import type { SignalType } from "@/types";

export const revalidate = 0;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const company = await db.query.companies.findFirst({
    where: or(eq(schema.companies.id, id), eq(schema.companies.slug, id)),
    with: {
      signals:         { orderBy: (s, { desc }) => [desc(s.date)], limit: 5 },
      mandateMatches:  { with: { mandate: true }, orderBy: (m, { desc }) => [desc(m.score)], limit: 2 },
      founders:        true,
      financialHistory:{ orderBy: (f, { asc })  => [asc(f.year)] },
    },
  });

  if (!company) notFound();

  const topMandate = company.mandateMatches[0];
  const radarAxes = ["Mercado", "Producto", "Equipo", "Finanzas", "Estrategia", "Riesgo"];
  const radarVals = [85, 78, 90, 72, 80, 65];
  const revTrend = company.financialHistory
    .filter((s) => s.quarter === 0)
    .map((s) => (s.revenueUsd ?? 0) / 1000);

  const RECOMMENDATION = company.score >= 85 ? "PROCEDER" : company.score >= 70 ? "INVESTIGAR MÁS" : "MONITOREAR";
  const REC_COLOR = company.score >= 85 ? "#059669" : company.score >= 70 ? "#d97706" : "#828282";

  return (
    <div>
      <Topbar
        title="Internal Review"
        subtitle={`2-pager — ${company.name}`}
        actions={<PrintButton />}
      />

      <div className="p-6">
        <div className="print-doc max-w-[800px] mx-auto bg-paper rounded-card shadow-float overflow-hidden">
          {/* Header dark */}
          <div className="bg-carbon px-8 py-6">
            <div className="flex items-start justify-between">
              <div>
                <Logo dark size="sm" className="mb-4" />
                <h1 className="text-[24px] font-semibold text-white tracking-tight font-poly leading-tight">{company.name}</h1>
                <p className="text-[13px] text-white/60 mt-1">{company.sector} · {company.country} · {company.stage}</p>
              </div>
              <div className="text-right">
                <div className="text-[36px] font-bold text-white font-poly leading-none">{company.score}</div>
                <div className="text-[10px] text-white/50 uppercase tracking-wide">score PANDO</div>
                <div className="mt-2 px-3 py-1 rounded-full text-[11px] font-bold inline-block" style={{ background: REC_COLOR, color: "white" }}>
                  {RECOMMENDATION}
                </div>
              </div>
            </div>
          </div>

          <div className="px-8 py-6 space-y-6">
            {/* Summary */}
            <div>
              <h2 className="text-[13px] font-semibold text-carbon uppercase tracking-wide mb-2">Resumen ejecutivo</h2>
              <p className="text-[13px] text-graphite leading-relaxed">
                {company.description ?? "Sin descripción disponible."}
                {" "}Con un revenue de <strong>{fmtM(company.revenueUsd)}</strong> y crecimiento de{" "}
                <strong>{fmtPct(company.revenueGrowth)}</strong> YoY, la empresa presenta{" "}
                {company.score >= 80 ? "una oportunidad atractiva" : "métricas a revisar"} dentro del mandato{" "}
                <em>{(topMandate as any)?.mandate?.name ?? "activo"}</em> con match de{" "}
                <strong>{topMandate?.score ?? "—"}/100</strong>.
              </p>
            </div>

            {/* Metrics + Charts */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h2 className="text-[13px] font-semibold text-carbon uppercase tracking-wide mb-3">Métricas clave</h2>
                <div className="space-y-2">
                  {[
                    { l: "Revenue (TTM)",          v: fmtM(company.revenueUsd) },
                    { l: "Crecimiento YoY",         v: fmtPct(company.revenueGrowth) },
                    { l: "EBITDA",                  v: fmtM(company.ebitdaUsd) },
                    { l: "Margen EBITDA",           v: company.ebitdaMargin != null ? `${company.ebitdaMargin.toFixed(1)}%` : "—" },
                    { l: "Empleados",               v: company.employees?.toLocaleString("es-MX") ?? "—" },
                    { l: "Crecimiento headcount",   v: fmtPct(company.employeeGrowth) },
                    { l: "Total funding",           v: fmtM(company.totalFunding) },
                    { l: "Última ronda",            v: `${fmtM(company.lastFundingAmt)} (${company.fundingStage ?? "—"})` },
                  ].map(({ l, v }) => (
                    <div key={l} className="flex justify-between text-[12px] border-b border-chalk py-1.5 last:border-0">
                      <span className="text-slate">{l}</span>
                      <span className="font-semibold text-carbon">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                {revTrend.length >= 2 && (
                  <div>
                    <div className="text-[11px] text-slate mb-1">Tendencia de revenue ($M)</div>
                    <Spark values={revTrend} width={300} height={60} color="#ff682c" />
                  </div>
                )}
                <div>
                  <div className="text-[11px] text-slate mb-1">Evaluación multidimensional</div>
                  <RadarChart axes={radarAxes} values={radarVals} size={130} />
                </div>
              </div>
            </div>

            {/* Mandate match */}
            {topMandate && (
              <div className="bg-fog rounded-[8px] p-4 border border-chalk">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-[13px] font-semibold text-carbon">Match: {(topMandate as any).mandate?.name}</h2>
                  <div className="flex items-center gap-2">
                    <Badge variant={topMandate.tier === "strong" ? "green" : "yellow"}>
                      {topMandate.tier === "strong" ? "Fuerte" : "Candidato"}
                    </Badge>
                    <span className="text-[14px] font-bold text-carbon">{topMandate.score}/100</span>
                  </div>
                </div>
                {topMandate.rationale && <p className="text-[12px] text-graphite leading-relaxed">{topMandate.rationale}</p>}
              </div>
            )}

            {/* Signals */}
            <div>
              <h2 className="text-[13px] font-semibold text-carbon uppercase tracking-wide mb-3">Señales detectadas</h2>
              {company.signals.length === 0 ? (
                <p className="text-[12px] text-slate">Sin señales registradas.</p>
              ) : (
                <div className="space-y-2">
                  {company.signals.map((s) => (
                    <div key={s.id} className="flex items-start gap-2.5 py-2 border-b border-chalk last:border-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <SignalBadge type={s.type as SignalType} severity={s.severity} />
                        <span className="text-[10px] text-slate">{fmtDate(s.date)}</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-[12px] text-carbon">{s.title}</p>
                        {s.detail && <p className="text-[11px] text-graphite mt-0.5">{s.detail}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Founders */}
            {company.founders.length > 0 && (
              <div>
                <h2 className="text-[13px] font-semibold text-carbon uppercase tracking-wide mb-3">Equipo fundador</h2>
                <div className="grid grid-cols-2 gap-3">
                  {company.founders.map((f) => (
                    <div key={f.id} className="flex items-start gap-2.5 bg-fog rounded-[8px] p-3 border border-chalk">
                      <div className="w-7 h-7 rounded-full bg-carbon flex items-center justify-center text-white text-[10px] font-bold flex-none">
                        {f.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <div className="text-[12px] font-semibold text-carbon">{f.name}</div>
                        {f.title && <div className="text-[10px] text-slate">{f.title}</div>}
                        {f.bio && <div className="text-[11px] text-graphite mt-1">{f.bio}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendation */}
            <div className="border-t-2 pt-4" style={{ borderColor: REC_COLOR }}>
              <div className="flex items-center gap-3 mb-2">
                <div className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: REC_COLOR }}>
                  Recomendación PANDO
                </div>
                <div className="px-3 py-1 rounded-full text-[11px] font-bold text-white inline-block" style={{ background: REC_COLOR }}>
                  {RECOMMENDATION}
                </div>
              </div>
              <p className="text-[12px] text-graphite leading-relaxed">
                {company.score >= 85
                  ? `${company.name} cumple los criterios del mandato con alto grado de confianza. Se recomienda iniciar due diligence formal y coordinar primera reunión con el equipo directivo.`
                  : company.score >= 70
                  ? `${company.name} presenta características alineadas con la tesis pero requiere validar métricas clave antes de avanzar. Se recomienda solicitar información financiera adicional.`
                  : `${company.name} continúa en seguimiento. Las señales detectadas justifican monitoreo activo para evaluar si el perfil evoluciona hacia los criterios del mandato.`}
              </p>
            </div>

            <div className="border-t border-chalk pt-4 flex items-center justify-between text-[10px] text-slate">
              <span>Generado por PANDO · {new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}</span>
              <span>Documento confidencial — uso interno</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
