"use client";
// Shown on a company that has no deal yet: every company lives inside a deal.
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NewDealModal } from "@/components/deals/NewDealModal";

export function CreateDealBanner({ companyId, companyName, phase }: { companyId: string; companyName: string; phase: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-olive">
        <div>
          <p className="text-[13px] font-medium text-carbon">{companyName} doesn&apos;t have a deal yet</p>
          <p className="text-[12px] text-slate mt-0.5">Companies live inside their deal: create it and everything here (documents, comps, valuation, cap table) moves with it.</p>
        </div>
        <Button variant="fill" size="sm" onClick={() => setOpen(true)}>+ Create deal</Button>
      </Card>
      {open && <NewDealModal onClose={() => setOpen(false)} companyId={companyId} companyName={companyName} phase={phase} />}
    </>
  );
}
