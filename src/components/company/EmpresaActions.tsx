"use client";
import { useState, useEffect, useRef } from "react";
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

// Generators open with this company (and its uploaded files) preselected.
const GENERATE_OPTIONS = [
  { label: "2-pager",           hint: "Investment brief",            href: (id: string) => `/documentos?company=${id}&type=twopager` },
  { label: "Presentation",      hint: "PowerPoint deck",             href: (id: string) => `/documentos?company=${id}&type=pptx` },
  { label: "Word document",     hint: "Memo or report",              href: (id: string) => `/documentos?company=${id}&type=docx` },
  { label: "IRL",               hint: "Information request list",    href: (id: string) => `/documentos?company=${id}&type=irl` },
  { label: "LBO model (Excel)", hint: "Financial model",             href: (id: string) => `/financial-models?company=${id}` },
];

export function EmpresaActions({ company }: { company: CompanyData }) {
  const [editOpen, setEditOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const genRef = useRef<HTMLDivElement>(null);
  const genBtn = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  function toggleGen() {
    if (genOpen) { setGenOpen(false); return; }
    const r = genBtn.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 240, window.innerWidth - 248)) });
    setGenOpen(true);
  }
  const router = useRouter();

  useEffect(() => {
    if (!genOpen) return;
    const close = (e: MouseEvent) => { if (genRef.current && !genRef.current.contains(e.target as Node)) setGenOpen(false); };
    const hide = () => setGenOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", hide);
    document.querySelector("main")?.addEventListener("scroll", hide);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", hide);
      document.querySelector("main")?.removeEventListener("scroll", hide);
    };
  }, [genOpen]);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setEditOpen(true)}
          className="px-3.5 pt-[7px] pb-[5px] font-display text-[10.5px] uppercase tracking-[.16em] bg-pistacho text-olive border border-pistacho hover:bg-white hover:border-white transition-colors duration-300 flex items-center gap-1.5"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit
        </button>
        <div ref={genRef} className="relative">
          <button
            ref={genBtn}
            onClick={toggleGen}
            aria-expanded={genOpen}
            className="px-3.5 pt-[7px] pb-[5px] font-display text-[10.5px] uppercase tracking-[.16em] border border-white/45 text-white hover:bg-pistacho hover:text-olive hover:border-pistacho transition-colors duration-300 flex items-center gap-1.5"
          >
            Generate
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {genOpen && menuPos && (
            <div className="fixed w-[240px] bg-paper border border-chalk shadow-xl z-[80] py-1 normal-case tracking-normal"
              style={{ top: menuPos.top, left: menuPos.left }}>
              {GENERATE_OPTIONS.map(o => (
                <Link key={o.label} href={o.href(company.id)} onClick={() => setGenOpen(false)}
                  className="block px-3 py-2 hover:bg-fog transition-colors">
                  <span className="block text-[12px] font-medium text-carbon">{o.label}</span>
                  <span className="block text-[10px] text-slate">{o.hint}</span>
                </Link>
              ))}
              <div className="border-t border-chalk my-1" />
              <Link href={`/review/${company.slug}`} onClick={() => setGenOpen(false)}
                className="block px-3 py-2 hover:bg-fog transition-colors">
                <span className="block text-[12px] font-medium text-carbon">Internal review page</span>
                <span className="block text-[10px] text-slate">Quick on-screen summary</span>
              </Link>
              <p className="px-3 pt-1 pb-1.5 text-[10px] text-slate">Uses this company&apos;s data and the files uploaded to its profile.</p>
            </div>
          )}
        </div>
        <Link href={`/valuation/${company.id}`}>
          <button className="px-3.5 pt-[7px] pb-[5px] font-display text-[10.5px] uppercase tracking-[.16em] border border-white/45 text-white hover:bg-pistacho hover:text-olive hover:border-pistacho transition-colors duration-300">
            Valuation
          </button>
        </Link>
        <Link href={`/comparables?company=${company.id}`}>
          <button className="px-3.5 pt-[7px] pb-[5px] font-display text-[10.5px] uppercase tracking-[.16em] border border-white/45 text-white hover:bg-pistacho hover:text-olive hover:border-pistacho transition-colors duration-300">
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
