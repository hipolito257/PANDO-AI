import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { db } from "@/lib/db";
import { desc, inArray } from "drizzle-orm";
import * as schema from "@/lib/schema";
import Link from "next/link";

export const revalidate = 0;

export default async function ReviewListPage() {
  const pipeline = await db.query.companies.findMany({
    where: (c, { inArray }) => inArray(c.status, ["pipeline", "monitoring"]),
    orderBy: [desc(schema.companies.score)],
    limit: 12,
  });

  return (
    <div>
      <Topbar title="Internal Review" subtitle="2-pagers generados por IA" />
      <div className="p-6">
        <div className="grid grid-cols-3 gap-4">
          {pipeline.map((c) => (
            <Link key={c.id} href={`/review/${c.slug}`}>
              <Card className="hover:border-carbon border border-transparent transition-all cursor-pointer">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-[4px] bg-carbon flex items-center justify-center text-white text-[9px] font-bold">
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-carbon">{c.name}</div>
                    <div className="text-[10px] text-slate">{c.sector} · {c.country}</div>
                  </div>
                </div>
                <div className="text-[11px] text-graphite line-clamp-2 mb-2">{c.description ?? "Sin descripción."}</div>
                <div className="text-[10px] text-slate">Generar 2-pager →</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
