import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { CompanyLogo } from "@/components/company/CompanyLogo";
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
      <Topbar title="Internal Review" subtitle="AI-generated 2-pagers" />
      <div className="p-6">
        <div className="grid grid-cols-3 gap-4">
          {pipeline.map((c) => (
            <Link key={c.id} href={`/review/${c.slug}`}>
              <Card className="hover:border-carbon border border-transparent transition-all cursor-pointer">
                <div className="flex items-center gap-2 mb-2">
                  <CompanyLogo name={c.name} website={c.website} size="sm" />
                  <div>
                    <div className="text-[13px] font-semibold text-carbon">{c.name}</div>
                    <div className="text-[10px] text-slate">{c.sector} · {c.country}</div>
                  </div>
                </div>
                <div className="text-[11px] text-graphite line-clamp-2 mb-2">{c.description ?? "No description."}</div>
                <div className="text-[10px] text-slate">Generate 2-pager →</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
