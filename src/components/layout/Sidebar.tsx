"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";
import { DEAL_DRAG_END, DEAL_DRAG_START, DEAL_DRAG_TYPE, moveDealToPhase, type Phase } from "@/lib/phases";

// The platform's five sections; each opens to show its pages. Deals move
// between Deal Sourcing, Portfolio and Exit: those sections are drop targets
// while a deal card is being dragged.
type NavItem = { href: string; label: string; badge?: "radar" | "exit" | "alerts" };
type Section = {
  key: string; label: string; icon: React.ReactNode; items: NavItem[];
  phase?: Phase;            // sections that hold deals
  also?: string[];          // other paths that belong to the section
};

const SECTIONS: Section[] = [
  { key: "general", label: "General", icon: <IconDash />, items: [
    { href: "/", label: "Overview" },
    { href: "/equipo", label: "Team" },
    { href: "/search", label: "Search" },
    { href: "/translate", label: "Translate" },
    { href: "/conectores", label: "Connectors" },
  ] },
  { key: "fundraising", label: "Fundraising", icon: <IconFundraising />, items: [
    { href: "/fundraising", label: "Overview" },
    { href: "/fundraising/pipeline", label: "Investor pipeline" },
    { href: "/fundraising/investors", label: "Investor map" },
    { href: "/fundraising/sheet", label: "Google Sheet" },
  ] },
  { key: "sourcing", label: "Deal Sourcing", icon: <IconRadar />, phase: "sourcing", also: ["/empresa", "/valuation", "/review", "/deals"], items: [
    { href: "/sourcing", label: "Overview" },
    { href: "/deals", label: "Pipeline", badge: "alerts" },
    { href: "/mandatos", label: "Mandates" },
    { href: "/comparables", label: "Comparables" },
    { href: "/documentos", label: "Documents" },
    { href: "/financial-models", label: "Models" },
  ] },
  { key: "portfolio", label: "Portfolio", icon: <IconPortfolio />, phase: "portfolio", items: [
    { href: "/portfolio", label: "Companies" },
    { href: "/portfolio/board", label: "Board" },
  ] },
  { key: "exit", label: "Exit", icon: <IconExit />, phase: "exit", items: [
    { href: "/exits", label: "Exit pipeline" },
  ] },
];

const DEAL_PAGE = /^\/deals\/[^/]+$/;

const itemActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

/** The section the current page belongs to (a deal page tells us its section via an event). */
function sectionOf(pathname: string, dealPhase: string | null): string {
  if (dealPhase && DEAL_PAGE.test(pathname)) return SECTIONS.find(s => s.phase === dealPhase)?.key ?? "sourcing";
  let best = "general", len = -1;
  for (const s of SECTIONS) {
    for (const href of [...s.items.map(i => i.href), ...(s.also ?? [])]) {
      if (itemActive(href, pathname) && href.length > len) { best = s.key; len = href.length; }
    }
  }
  return best;
}

/** Fired by a deal page so the menu opens that deal's section. */
const ACTIVE_SECTION_EVENT = "pando:active-section";

type Badges = { radar?: number; exit?: number; alerts?: number };

export function Sidebar({ badges = {} }: { badges?: Badges }) {
  const pathname  = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // On phones the menu is a drawer opened from the top bar's ☰ button.
  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("pando:open-menu", open);
    return () => window.removeEventListener("pando:open-menu", open);
  }, []);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <>
      <aside
        data-sidebar
        className={cn(
          "no-print hidden md:flex flex-col shrink-0 bg-forest h-[100dvh] sticky top-0",
          "transition-[width] duration-300 ease-in-out overflow-hidden",
          collapsed ? "w-[56px]" : "w-[208px]",
        )}
      >
        <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} pathname={pathname} badges={badges} />
      </aside>
      {mobileOpen && (
        <div className="no-print md:hidden fixed inset-0 z-[60] flex">
          <aside className="flex flex-col bg-forest w-[260px] max-w-[80vw] h-full shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <SidebarContent collapsed={false} onToggle={() => setMobileOpen(false)} pathname={pathname} badges={badges} mobile />
          </aside>
          <button aria-label="Close menu" className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}

function SidebarContent({ collapsed, onToggle, pathname, badges, mobile }: {
  collapsed: boolean; onToggle: () => void; pathname: string; badges: Badges; mobile?: boolean;
}) {
  return (
    <>
      {/* Logo + collapse toggle */}
      <div className="flex items-center h-[60px] px-2 border-b border-white/10 shrink-0 gap-2">
        <Link href="/inicio" title="PANDO home" className={cn("flex-1 overflow-hidden transition-opacity duration-200", collapsed ? "opacity-0 w-0" : "opacity-100")}>
          <Logo size="sm" />
        </Link>
        <button
          onClick={onToggle}
          title={mobile ? "Close menu" : collapsed ? "Expand menu" : "Collapse menu"}
          className="w-8 h-8 flex items-center justify-center rounded-[7px] hover:bg-white/10 text-white/60 hover:text-white transition-colors shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            {mobile ? (
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            ) : collapsed ? (
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            ) : (
              <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            )}
          </svg>
        </button>
      </div>

      {/* Nav: five sections, each opening to its pages */}
      <SectionNav collapsed={collapsed} pathname={pathname} badges={badges} mobile={mobile} />

      {/* Bottom */}
      <div className="p-2 border-t border-white/10 space-y-0.5">
        <Link
          href="/settings"
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "flex items-center border-l-2 font-display text-[11px] uppercase tracking-[.16em] transition-colors w-full",
            collapsed ? "justify-center py-2.5 px-1" : mobile ? "gap-3 px-3 pt-[13px] pb-[11px] !text-[13px]" : "gap-3 px-3 pt-[9px] pb-[7px]",
            pathname === "/settings" ? "border-pistacho bg-white/[0.06] text-pistacho" : "border-transparent text-white/60 hover:bg-white/[0.04] hover:text-white",
          )}
        >
          <span className="w-4 h-4 flex-none flex items-center justify-center opacity-90"><IconGear /></span>
          {!collapsed && <span>Settings</span>}
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "flex items-center border-l-2 border-transparent font-display text-[11px] uppercase tracking-[.16em] text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors w-full",
            collapsed ? "justify-center py-2.5 px-1" : mobile ? "gap-3 px-3 pt-[13px] pb-[11px] !text-[13px]" : "gap-3 px-3 pt-[9px] pb-[7px]",
          )}
        >
          <IconLogout />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </>
  );
}

function SectionNav({ collapsed, pathname, badges, mobile }: { collapsed: boolean; pathname: string; badges: Badges; mobile?: boolean }) {
  const [dealPhase, setDealPhase] = useState<string | null>(null);
  const current = sectionOf(pathname, dealPhase);
  const [open, setOpen] = useState<Set<string>>(() => new Set([current]));
  const [drag, setDrag] = useState<{ dealId: string; phase: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);

  // Moving to another section opens it and folds the rest, so the menu stays short.
  useEffect(() => { setOpen(new Set([current])); }, [current]);
  useEffect(() => {
    const onSection = (e: Event) => setDealPhase((e as CustomEvent).detail?.phase ?? null);
    const onStart = (e: Event) => setDrag((e as CustomEvent).detail ?? null);
    const onEnd = () => { setDrag(null); setOver(null); };
    window.addEventListener(ACTIVE_SECTION_EVENT, onSection);
    window.addEventListener(DEAL_DRAG_START, onStart);
    window.addEventListener(DEAL_DRAG_END, onEnd);
    return () => {
      window.removeEventListener(ACTIVE_SECTION_EVENT, onSection);
      window.removeEventListener(DEAL_DRAG_START, onStart);
      window.removeEventListener(DEAL_DRAG_END, onEnd);
    };
  }, []);
  // Also read what the deal page left behind, in case it announced itself before the menu was listening.
  useEffect(() => {
    if (!DEAL_PAGE.test(pathname)) { setDealPhase(null); return; }
    const last = (window as unknown as { __pandoSection?: { path: string; phase: string } }).__pandoSection;
    if (last?.path === pathname) setDealPhase(last.phase);
  }, [pathname]);
  useEffect(() => { if (!moved) return; const t = setTimeout(() => setMoved(null), 1600); return () => clearTimeout(t); }, [moved]);

  const toggle = (key: string) => setOpen(o => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <nav className="flex-1 p-2 overflow-y-auto overflow-x-hidden">
      {SECTIONS.map(sec => {
        const isCurrent = sec.key === current;
        const isOpen = open.has(sec.key) && !collapsed;
        const target = !!drag && !!sec.phase && sec.phase !== drag.phase;
        const total = sec.items.reduce((n, i) => n + (i.badge ? (badges[i.badge] ?? 0) : 0), 0);
        const activeItem = sec.items.filter(i => itemActive(i.href, pathname)).sort((x, y) => y.href.length - x.href.length)[0];
        return (
          <div key={sec.key} className="mb-1"
            onDragOver={target ? e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(sec.key); } : undefined}
            onDragLeave={target ? () => setOver(o => (o === sec.key ? null : o)) : undefined}
            onDrop={target ? async e => {
              e.preventDefault();
              const id = e.dataTransfer.getData(DEAL_DRAG_TYPE) || drag?.dealId;
              setOver(null); setDrag(null);
              window.dispatchEvent(new Event(DEAL_DRAG_END));
              if (id && sec.phase) { const r = await moveDealToPhase(id, sec.phase); if (r.ok) setMoved(sec.key); }
            } : undefined}>
            {collapsed ? (
              <Link href={sec.items[0].href} title={sec.label}
                className={cn("flex items-center justify-center py-2.5 border-l-2 transition-colors",
                  isCurrent ? "border-pistacho text-pistacho bg-white/[0.06]" : "border-transparent text-white/60 hover:text-white hover:bg-white/[0.04]",
                  target && "outline outline-1 outline-dashed outline-pistacho/70", over === sec.key && "bg-pistacho !text-olive")}>
                <span className="w-4 h-4 flex items-center justify-center">{sec.icon}</span>
              </Link>
            ) : (
              <button onClick={() => toggle(sec.key)} aria-expanded={isOpen}
                className={cn("w-full flex items-center gap-3 border-l-2 font-display uppercase tracking-[.16em] transition-colors duration-200",
                  mobile ? "px-3 pt-[13px] pb-[11px] text-[13px]" : "px-3 pt-[10px] pb-[8px] text-[11.5px]",
                  isCurrent ? "border-pistacho text-pistacho" : "border-transparent text-white/75 hover:text-white hover:bg-white/[0.04]",
                  target && "bg-white/[0.05] outline outline-1 outline-dashed outline-pistacho/60 -outline-offset-2",
                  over === sec.key && "!bg-pistacho !text-olive !outline-pistacho",
                  moved === sec.key && "!bg-pistacho/80 !text-olive")}>
                <span className="w-4 h-4 flex-none flex items-center justify-center opacity-90">{sec.icon}</span>
                <span className="flex-1 text-left whitespace-nowrap">{target ? `Move to ${sec.label}` : moved === sec.key ? "Moved \u2713" : sec.label}</span>
                {!isOpen && total > 0 && (
                  <span className="bg-pistacho text-olive text-[10px] font-semibold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center font-sans tracking-normal">{total > 99 ? "99+" : total}</span>
                )}
                <svg width="10" height="10" viewBox="0 0 10 10" className={cn("opacity-50 transition-transform duration-300", isOpen && "rotate-90")} aria-hidden><path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" /></svg>
              </button>
            )}
            {!collapsed && (
              <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                <div className="overflow-hidden">
                  <div className="ml-[22px] border-l border-white/10 pl-2 py-1 space-y-px">
                    {sec.items.map(item => {
                      const active = activeItem === item && (sec.key === current || item.href !== "/deals");
                      const count = item.badge ? (badges[item.badge] ?? 0) : 0;
                      return (
                        <Link key={item.href} href={item.href} tabIndex={isOpen ? 0 : -1}
                          className={cn("flex items-center gap-2 px-2.5 transition-colors duration-200",
                            mobile ? "py-2.5 text-[14px]" : "py-[6px] text-[12.5px]",
                            active ? "text-white bg-white/[0.07]" : "text-white/55 hover:text-white hover:bg-white/[0.04]")}>
                          <span className="flex-1 whitespace-nowrap">{item.label}</span>
                          {count > 0 && !active && (
                            <span title={item.badge === "alerts" ? "High interest, pending" : undefined}
                              className={cn("text-[10px] font-semibold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center", item.badge === "alerts" ? "bg-red-600 text-white" : "bg-pistacho text-olive")}>{count > 99 ? "99+" : count}</span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function IconFundraising() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <ellipse cx="7" cy="3.5" rx="5" ry="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 3.5v3.5c0 1.1 2.2 2 5 2s5-.9 5-2V3.5M2 7v3.5c0 1.1 2.2 2 5 2s5-.9 5-2V7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconPortfolio() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="4" width="11" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 4V2.8c0-.4.3-.8.8-.8h2.4c.5 0 .8.4.8.8V4M1.5 7.5h11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
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
function IconModels() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1" />
      <line x1="5" y1="5" x2="5" y2="13" stroke="currentColor" strokeWidth="1" />
      <path d="M7.5 11l1.3-2.3 1.1 1.3L11.5 7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconTranslate() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1 3h6M4 1.5v1.5M2.5 3c0 2.5 1.8 4 3.5 4.5M5.5 3c-.3 2-1.7 4.5-4.5 5.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8.5 13l2.3-6h.4l2.3 6M9.2 11h3.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
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
function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M9.2 9.2L12.5 12.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function IconDeals() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="3.4" height="10" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <rect x="5.3" y="2" width="3.4" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <rect x="9.6" y="2" width="3.4" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
function IconTeam() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="5" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 12c0-2 1.6-3.5 3.5-3.5S8.5 10 8.5 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="10" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.1" />
      <path d="M9.5 8.6c1.7-.2 3 1.1 3 3.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
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
