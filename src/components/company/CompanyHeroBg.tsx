"use client";
import { useState, useEffect } from "react";

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch { return null; }
}

export function CompanyHeroBg({
  website,
}: {
  website?: string | null;
  name?: string;
}) {
  const domain = extractDomain(website);
  const [src, setSrc] = useState<string | null>(
    domain ? `https://logo.clearbit.com/${domain}` : null
  );

  useEffect(() => {
    const d = extractDomain(website);
    setSrc(d ? `https://logo.clearbit.com/${d}` : null);
  }, [website]);

  if (!src) return null;

  return (
    <div
      className="absolute right-0 inset-y-0 w-[320px] pointer-events-none select-none overflow-hidden"
      aria-hidden="true"
    >
      {/* Left gradient fade so logo doesn't clash with text */}
      <div className="absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-paper to-transparent z-10" />
      <div className="absolute inset-0 flex items-center justify-end pr-10">
        <img
          src={src}
          alt=""
          className="w-44 h-44 object-contain opacity-[0.07]"
          onError={() => setSrc(null)}
        />
      </div>
    </div>
  );
}
