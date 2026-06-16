import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Badge, SignalBadge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { desc, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/schema";
import { fmtM } from "@/lib/utils";
import Link from "next/link";
import type { SignalType } from "@/types";

export const revalidate = 0;

const STRATEGIC_BUYERS = [
  { name: "Vista Equity Partners",  type: "PE",          focus: "Software B2B",        region: "Global", matchScore: 92 },
  { name: "Softbank LATAM",         type: "VC/Growth",   focus: "Tech LATAM",          region: "LATAM",  matchScore: 88 },
  { name: "General Atlantic",       type: "PE",          focus: "Growth Tech",          region: "Global", matchScore: 85 },
  { name: "Advent International",   type: "PE",          focus: "Tech & Servicios",    region: "LATAM/Global", matchScore: 81 },
  { name: "Patria Investments",     type: "PE",          focus: "LATAM multi-sector",  region: "LATAM",  matchScore: 79 },
  { name: "Grupo Televisa Digital", type: "Estratégico", focus: "Media & Tech MX",     region: "México", matchScore: 74 },
];

export default async function ExitPage() {
  const pipeline = await db.query.companies.findMany({
    where: (c, { eq }) => eq(c.status, "pipeline"),
    with: {
      signals: {
        where: (s, { inArray }) => inArray(s.type, ["exit_rumor", "strategic_buyer_interest", "competitor_acquired"]),
        orderBy: (s, { desc }) => [desc(s.date)],
        limit: 2,
      },
    },
    orderBy: [desc(schema.companies.score)],
  });

  return (
    <div>
      <Topbar title="Exit" subtitle="Radar de M&A y estrategia de salida" />
      <div className="p-6 space-y-5">
        <Card>
          <SectionHeader title="Readiness de salida" subtitle="Empresas del pipeline con potencial de exit en 12-24 meses" />
          <div className="grid grid-cols-2 gap-3 mt-2">
            {pipeline.map((c) => {
              const readiness = c.score >= 85 ? "Alta" : c.score >= 70 ? "Media" : "Baja";
              const readinessColor = c.score >= 85 ? "green" : c.score >= 70 ? "yellow" : "default";
              return (
                <div key={c.id} className="bg-fog rounded-[8px] p-3 border border-chalk">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <Link href={`/empresa/${c.slug}`} className="text-[13px] font-semibold text-carbon hover:text-orange transition-colors">{c.name}</Link>
                      <div className="text-[10px] text-slate">{c.sector} · {c.country}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={readinessColor as "green" | "yellow" | "default"}>{readiness}</Badge>
                      <span className="text-[12px] font-bold text-carbon">{c.score}</span>
                    </div>
                  </div>
                  <div className="flex gap-3 text-[11px] mb-2">
                    <span><span className="text-slate">Rev:</span> <span className="font-medium text-carbon">{fmtM(c.revenueUsd)}</span></span>
                    {c.revenueGrowth != null && <span className="text-emerald-600 font-medium">+{c.revenueGrowth}%</span>}
                    <span><span className="text-slate">EV est.:</span> <span className="font-medium text-carbon">{fmtM((c.revenueUsd ?? 0) * 4.5)}</span></span>
                  </div>
                  {c.signals.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {c.signals.map((s) => <SignalBadge key={s.id} type={s.type as SignalType} severity={s.severity} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <SectionHeader title="Compradores estratégicos" subtitle="Match por tesis y capacidad de adquisición" />
            <div className="space-y-2 mt-2">
              {STRATEGIC_BUYERS.map((buyer) => (
                <div key={buyer.name} className="flex items-center gap-3 py-2 border-b border-chalk last:border-0">
                  <div className="w-7 h-7 rounded-[6px] bg-carbon flex items-center justify-center text-white text-[9px] font-bold flex-none">
                    {buyer.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-carbon">{buyer.name}</div>
                    <div className="text-[10px] text-slate">{buyer.focus} · {buyer.region}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={buyer.type === "PE" ? "carbon" : "blue"}>{buyer.type}</Badge>
                    <div className="text-[12px] font-bold" style={{ color: buyer.matchScore >= 85 ? "#059669" : buyer.matchScore >= 75 ? "#d97706" : "#828282" }}>
                      {buyer.matchScore}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeader title="M&A reciente en el espacio" subtitle="Transacciones relevantes en el mercado" />
            <div className="space-y-3 mt-2">
              {[
                { target: "Conciliac",  acquirer: "Nuvei",           price: "$18M",       date: "May 2026", sector: "Finance SaaS" },
                { target: "Kushki",     acquirer: "Mastercard",      price: "$125M",      date: "Mar 2026", sector: "Fintech" },
                { target: "Incode",     acquirer: "Undisclosed PE",  price: "$75M",       date: "Feb 2026", sector: "Identity SaaS" },
                { target: "Frubana",    acquirer: "Grupo Bimbo JV",  price: "Undisclosed",date: "Ene 2026", sector: "B2B eComm" },
              ].map((deal) => (
                <div key={deal.target} className="flex items-center gap-3 py-2 border-b border-chalk last:border-0">
                  <div className="flex-1">
                    <div className="text-[12px]">
                      <span className="font-semibold text-carbon">{deal.target}</span>
                      <span className="text-slate"> → {deal.acquirer}</span>
                    </div>
                    <div className="text-[10px] text-slate">{deal.sector} · {deal.date}</div>
                  </div>
                  <div className="text-[12px] font-semibold text-carbon">{deal.price}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
