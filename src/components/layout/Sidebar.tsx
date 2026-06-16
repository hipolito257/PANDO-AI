"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";

const NAV = [
  { href: "/",           label: "Dashboard",    icon: "⬛" },
  { href: "/radar",      label: "Radar",         icon: "📡", badge: 3 },
  { href: "/mandatos",   label: "Mandatos",      icon: "🎯" },
  { href: "/comparables", label: "Comparables",  icon: "⚖️" },
  { href: "/exit",       label: "Exit",          icon: "🚀" },
  { href: "/documentos",  label: "Documentos",    icon: "📄" },
  { href: "/conectores", label: "Conectores",    icon: "🔌" },
];

const ICON_MAP: Record<string, React.ReactNode> = {
  "/":            <IconDash />,
  "/radar":       <IconRadar />,
  "/mandatos":    <IconMandatos />,
  "/comparables": <IconComparables />,
  "/exit":        <IconExit />,
  "/documentos":  <IconDocumentos />,
  "/conectores":  <IconConectores />,
};

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside data-sidebar className="no-print flex flex-col w-[220px] shrink-0 bg-paper border-r border-chalk h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center h-[60px] px-5 border-b border-chalk">
        <Logo size="sm" />
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-colors",
                active
                  ? "bg-carbon text-white"
                  : "text-graphite hover:bg-fog hover:text-carbon"
              )}
            >
              <span className="w-4 h-4 flex-none flex items-center justify-center opacity-70">
                {ICON_MAP[item.href]}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.badge && !active && (
                <span className="bg-orange text-white text-[10px] font-semibold rounded-full w-4 h-4 flex items-center justify-center">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-chalk space-y-1">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-colors w-full",
            pathname === "/settings"
              ? "bg-carbon text-white"
              : "text-graphite hover:bg-fog hover:text-carbon"
          )}
        >
          <span className="w-4 h-4 flex-none flex items-center justify-center">⚙️</span>
          <span>Configuración</span>
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-3 px-3 py-2 rounded-[8px] text-[13px] text-slate hover:text-carbon hover:bg-fog w-full transition-colors"
        >
          <IconLogout />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}

// ── Icons (inline SVG, no library) ────────────────────────────────────────────
function IconDash() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1.5" fill="currentColor" />
      <rect x="8" y="1" width="5" height="5" rx="1.5" fill="currentColor" />
      <rect x="1" y="8" width="5" height="5" rx="1.5" fill="currentColor" />
      <rect x="8" y="8" width="5" height="5" rx="1.5" fill="currentColor" />
    </svg>
  );
}
function IconRadar() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7" r="3.5" stroke="currentColor" strokeWidth="1" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
      <line x1="7" y1="1" x2="7" y2="4.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function IconMandatos() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <line x1="4" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="4" y1="7.5" x2="8" y2="7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="4" y1="10" x2="7" y2="10" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
function IconComparables() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="8" width="3" height="5" rx="1" fill="currentColor" />
      <rect x="5.5" y="5" width="3" height="8" rx="1" fill="currentColor" />
      <rect x="10" y="2" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}
function IconExit() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 12 L6 7 L9 10 L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="9,3 13,3 13,7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconDocumentos() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 1h6l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M9 1v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      <line x1="4" y1="9.5" x2="8" y2="9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}
function IconConectores() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="3" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="3" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="11" r="2" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5" y1="6" x2="9" y2="4" stroke="currentColor" strokeWidth="1" />
      <line x1="5" y1="8" x2="9" y2="10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M6 2H2.5A1.5 1.5 0 001 3.5v7A1.5 1.5 0 002.5 12H6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <polyline points="9,4.5 13,7 9,9.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="13" y1="7" x2="5.5" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
