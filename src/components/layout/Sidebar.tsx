"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";

const NAV = [
  { href: "/",            label: "Dashboard"   },
  { href: "/radar",       label: "Radar"       },
  { href: "/mandatos",    label: "Mandates"    },
  { href: "/comparables", label: "Comparables" },
  { href: "/exit",        label: "Exit"        },
  { href: "/documentos",  label: "Documents"   },
  { href: "/conectores",  label: "Connectors"  },
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

type Badges = { radar?: number; exit?: number };

export function Sidebar({ badges = {} }: { badges?: Badges }) {
  const pathname  = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      data-sidebar
      className={cn(
        "no-print flex flex-col shrink-0 bg-paper border-r border-chalk h-screen sticky top-0",
        "transition-[width] duration-300 ease-in-out overflow-hidden",
        collapsed ? "w-[56px]" : "w-[220px]",
      )}
    >
      {/* Logo + collapse toggle */}
      <div className="flex items-center h-[60px] px-2 border-b border-chalk shrink-0 gap-2">
        <div className={cn("flex-1 overflow-hidden transition-opacity duration-200", collapsed ? "opacity-0 w-0" : "opacity-100")}>
          <Logo size="sm" />
        </div>
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          className="w-8 h-8 flex items-center justify-center rounded-[7px] hover:bg-fog text-slate hover:text-carbon transition-colors shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            {collapsed ? (
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            ) : (
              <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            )}
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV.map(item => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const count  = item.href === "/radar" ? (badges.radar ?? 0)
                       : item.href === "/exit"  ? (badges.exit  ?? 0) : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center rounded-[8px] text-[13px] font-medium transition-colors",
                collapsed ? "justify-center py-2.5 px-1" : "gap-3 px-3 py-2",
                active ? "bg-orange text-white" : "text-graphite hover:bg-fog hover:text-carbon",
              )}
            >
              <span className="w-4 h-4 flex-none flex items-center justify-center opacity-70">
                {ICON_MAP[item.href]}
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 whitespace-nowrap">{item.label}</span>
                  {count > 0 && !active && (
                    <span className="bg-orange text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="p-2 border-t border-chalk space-y-0.5">
        <Link
          href="/settings"
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "flex items-center rounded-[8px] text-[13px] font-medium transition-colors w-full",
            collapsed ? "justify-center py-2.5 px-1" : "gap-3 px-3 py-2",
            pathname === "/settings" ? "bg-orange text-white" : "text-graphite hover:bg-fog hover:text-carbon",
          )}
        >
          <span className="w-4 h-4 flex-none flex items-center justify-center opacity-70"><IconGear /></span>
          {!collapsed && <span>Settings</span>}
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "flex items-center rounded-[8px] text-[13px] text-slate hover:text-carbon hover:bg-fog transition-colors w-full",
            collapsed ? "justify-center py-2.5 px-1" : "gap-3 px-3 py-2",
          )}
        >
          <IconLogout />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
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
function IconGear() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.5 2.5l1.1 1.1M10.4 10.4l1.1 1.1M11.5 2.5l-1.1 1.1M3.6 10.4l-1.1 1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
