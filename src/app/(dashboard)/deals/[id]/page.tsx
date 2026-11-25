// Deal page: the deal itself plus everything about its company (overview, financials,
// cap table, documents, news, notes), loaded on the server and shown as tabs.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/schema";
import { loadCompanyView } from "@/components/company/CompanyView";
import { DealView } from "@/components/deals/DealView";

export const revalidate = 0;

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.select({ companyId: schema.deals.companyId }).from(schema.deals).where(eq(schema.deals.id, id)).limit(1).catch(() => []);
  const v = row[0] ? await loadCompanyView(row[0].companyId, { showDeals: true }).catch(() => null) : null;
  return <DealView id={id} company={v && { actions: v.actions, overview: v.overview, financials: v.financials, documents: v.documents, intel: v.intel, counts: v.counts }} />;
}
