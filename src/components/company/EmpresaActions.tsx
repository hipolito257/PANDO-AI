"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CompanyModal } from "./CompanyModal";

type CompanyData = {
  id: string;
  name: string;
  slug: string;
  sector?: string | null;
  subsector?: string | null;
  country: string;
  city?: string | null;
  stage?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  description?: string | null;
  revenueUsd?: number | null;
  revenueGrowth?: number | null;
  ebitdaUsd?: number | null;
  ebitdaMargin?: number | null;
  employees?: number | null;
  employeeGrowth?: number | null;
  totalFunding?: number | null;
  lastFundingAmt?: number | null;
  fundingStage?: string | null;
  score: number;
  status: string;
};

export function EmpresaActions({ company }: { company: CompanyData }) {
  const [editOpen, setEditOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setEditOpen(true)}
          className="px-3 py-1.5 text-[12px] font-medium bg-carbon text-white rounded-[8px] hover:opacity-85 transition-opacity flex items-center gap-1.5"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit
        </button>
        <Link href={`/review/${company.slug}`}>
          <button className="px-3 py-1.5 text-[12px] font-medium bg-fog border border-chalk rounded-[8px] text-graphite hover:bg-chalk transition-colors">
            Generate 2-pager
          </button>
        </Link>
        <Link href="/comparables">
          <button className="px-3 py-1.5 text-[12px] font-medium bg-fog border border-chalk rounded-[8px] text-graphite hover:bg-chalk transition-colors">
            View comps
          </button>
        </Link>
      </div>

      <CompanyModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={company}
        onSaved={() => {
          setEditOpen(false);
          router.refresh(); // re-fetch server component data
        }}
      />
    </>
  );
}
