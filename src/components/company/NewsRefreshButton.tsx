"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewsRefreshButton({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<{ added: number } | null>(null);
  const router = useRouter();

  async function sync() {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/sync/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
    const data = await res.json();
    setResult({ added: data.totalAdded ?? 0 });
    setLoading(false);
    router.refresh(); // re-render server component with new news
  }

  return (
    <button
      onClick={sync}
      disabled={loading}
      className="flex items-center gap-1.5 text-[11px] text-slate hover:text-carbon disabled:opacity-50 transition-colors"
      title="Actualizar noticias desde Google News"
    >
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className={loading ? "animate-spin" : ""}
      >
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
      {loading ? "Actualizando..." : result ? `+${result.added} nuevas` : "Actualizar noticias"}
    </button>
  );
}
