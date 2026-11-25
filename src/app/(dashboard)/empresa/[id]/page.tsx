// Companies and deals go together: a company's page is its deal. This only
// renders on its own for a company that has no deal yet, inviting to create one.
import { notFound, redirect } from "next/navigation";
import { desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/schema";
import { Topbar } from "@/components/layout/Topbar";
import { loadCompanyView } from "@/components/company/CompanyView";
import { CreateDealBanner } from "@/components/deals/CreateDealBanner";

export const revalidate = 0;

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c] = await db.select({ id: schema.companies.id, status: schema.companies.status }).from(schema.companies)
    .where(or(eq(schema.companies.id, id), eq(schema.companies.slug, id))).limit(1);
  if (!c) notFound();
  const [deal] = await db.select({ id: schema.deals.id }).from(schema.deals)
    .where(eq(schema.deals.companyId, c.id)).orderBy(desc(schema.deals.updatedAt)).limit(1);
  if (deal) redirect(`/deals/${deal.id}#company`);

  const v = await loadCompanyView(c.id, { showDeals: false });
  if (!v) notFound();
  return (
    <div>
      <Topbar title={v.company.name} subtitle={`${v.company.sector ?? ""} · ${v.company.country}`} actions={v.actions} />
      <div className="p-6 space-y-4">
        <CreateDealBanner companyId={c.id} companyName={v.company.name} phase={c.status === "portfolio" ? "portfolio" : "sourcing"} />
        {v.overview}
        {v.financials}
        {v.documents}
        {v.intel}
      </div>
    </div>
  );
}
