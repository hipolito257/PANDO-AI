import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { loadCompanyView } from "@/components/company/CompanyView";

export const revalidate = 0;

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await loadCompanyView(id);
  if (!v) notFound();
  return (
    <div>
      <Topbar title={v.company.name} subtitle={`${v.company.sector ?? ""} · ${v.company.country}`} actions={v.actions} />
      <div className="p-6 space-y-4">
        {v.overview}
        {v.financials}
        {v.documents}
        {v.intel}
      </div>
    </div>
  );
}
