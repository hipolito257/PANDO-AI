"use client";
import { useState, useEffect } from "react";

function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const SIZES = {
  xs: { wrapper: "w-4 h-4",   text: "text-[7px]"  },
  sm: { wrapper: "w-6 h-6",   text: "text-[9px]"  },
  md: { wrapper: "w-8 h-8",   text: "text-[11px]" },
  lg: { wrapper: "w-10 h-10", text: "text-[13px]" },
} as const;

export function CompanyLogo({
  name,
  website,
  size = "sm",
  className = "",
}: {
  name: string;
  website?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [src, setSrc]       = useState<string | null>(() => {
    const d = extractDomain(website);
    return d ? `https://logo.clearbit.com/${d}` : null;
  });
  const [failed, setFailed] = useState(false);

  // Reset when the company changes (website prop changes)
  useEffect(() => {
    const d = extractDomain(website);
    setSrc(d ? `https://logo.clearbit.com/${d}` : null);
    setFailed(false);
  }, [website]);

  const { wrapper, text } = SIZES[size];
  const initials = name.trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  if (src && !failed) {
    return (
      <div className={`${wrapper} rounded-[5px] border border-chalk bg-white overflow-hidden flex items-center justify-center flex-none shrink-0 ${className}`}>
        <img
          src={src}
          alt={name}
          className="w-full h-full object-contain p-[1px]"
          onError={() => {
            const d = extractDomain(website);
            if (d && src.includes("clearbit")) {
              setSrc(`https://www.google.com/s2/favicons?domain=${d}&sz=64`);
            } else {
              setFailed(true);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={`${wrapper} rounded-[5px] bg-carbon flex items-center justify-center text-white font-bold flex-none shrink-0 ${className}`}>
      <span className={text}>{initials}</span>
    </div>
  );
}
