"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { ChatPanel } from "./ChatPanel";
import Link from "next/link";

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

type Signal = {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  severity: string;
  isRead: boolean;
  date: string | null;
  company: { id: string; name: string; slug: string; status: string } | null;
};

const SIGNAL_ICON: Record<string, string> = {
  funding_due: "💰",
  strategic_buyer_interest: "🤝",
  exec_change: "👤",
  revenue_inflection: "📈",
  risk_flag: "⚠️",
  exit_rumor: "🏁",
  exit_signal: "🚨",
  competitor_acquired: "🔀",
  hiring_surge: "🚀",
  regulatory_change: "⚖️",
};

function fmtRelative(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)   return "Ahora";
  if (mins < 60)  return `Hace ${mins}m`;
  if (hours < 24) return `Hace ${hours}h`;
  if (days < 7)   return `Hace ${days}d`;
  return new Date(dateStr).toLocaleDateString("es-MX", { month: "short", day: "numeric" });
}

export function Topbar({ title, subtitle, actions }: TopbarProps) {
  const [query, setQuery]             = useState("");
  const [chatOpen, setChatOpen]       = useState(false);
  const [initialQuery, setInitialQuery] = useState("");

  // Notifications
  const [bellOpen, setBellOpen]       = useState(false);
  const [signals, setSignals]         = useState<Signal[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingBell, setLoadingBell] = useState(false);
  const bellRef                       = useRef<HTMLDivElement>(null);

  // Load unread count on mount + every 60s
  const fetchUnreadCount = useCallback(async () => {
    try {
      const d = await fetch("/api/signals?unread=true&limit=1").then(r => r.json());
      setUnreadCount(d.unreadCount ?? 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Open bell panel: fetch signals + mark all read
  async function openBell() {
    if (bellOpen) { setBellOpen(false); return; }
    setLoadingBell(true);
    setBellOpen(true);
    try {
      const d = await fetch("/api/signals?limit=30").then(r => r.json());
      setSignals(d.signals ?? []);
      // Mark all as read
      if ((d.unreadCount ?? 0) > 0) {
        await fetch("/api/signals", { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }) });
        setUnreadCount(0);
      }
    } catch { /* silent */ }
    setLoadingBell(false);
  }

  // Close on outside click
  useEffect(() => {
    if (!bellOpen) return;
    function handler(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [bellOpen]);

  function openChat(q?: string) {
    const text = q ?? query;
    setInitialQuery(text);
    setChatOpen(true);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim()) openChat();
  }

  return (
    <>
      <header data-no-print className="no-print h-[60px] px-6 flex items-center justify-between border-b border-chalk bg-paper sticky top-0 z-40">
        {/* Title */}
        <div>
          <h1 className="text-[16px] font-semibold text-carbon tracking-tight">{title}</h1>
          {subtitle && <p className="text-[11px] text-slate mt-0">{subtitle}</p>}
        </div>

        {/* Ask PANDO bar */}
        <div className="flex-1 max-w-[400px] mx-8">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate" width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
              <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Pregunta algo a PANDO..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (!query) openChat(""); }}
              className="w-full pl-8 pr-4 py-1.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-carbon focus:bg-paper transition-colors cursor-pointer"
              readOnly={chatOpen}
            />
            {query && (
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate bg-chalk px-1.5 py-0.5 rounded">↵</kbd>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {actions}

          {/* Chat button */}
          <button onClick={() => openChat("")}
            className="relative w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-fog text-slate hover:text-carbon transition-colors"
            title="Abrir PANDO AI">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 1C3.91 1 1 3.69 1 7c0 1.47.56 2.82 1.5 3.87L1.5 14l3.5-1.5C6.1 13 6.79 13 7.5 13c3.59 0 6.5-2.69 6.5-6S11.09 1 7.5 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-green-500 rounded-full" />
          </button>

          {/* Notifications bell */}
          <div ref={bellRef} className="relative">
            <button
              onClick={openBell}
              className={`relative w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-fog transition-colors ${bellOpen ? "bg-fog text-carbon" : "text-slate hover:text-carbon"}`}
              title="Notificaciones"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M7.5 1.5A4.5 4.5 0 003 6v3l-1.5 2h12L12 9V6A4.5 4.5 0 007.5 1.5z" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6.3 12.5a1.2 1.2 0 002.4 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-orange text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {/* Notifications dropdown */}
            {bellOpen && (
              <div className="absolute right-0 top-10 w-[360px] bg-paper border border-chalk rounded-[12px] shadow-xl z-50 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-chalk">
                  <p className="text-[13px] font-semibold text-carbon">Señales recientes</p>
                  <div className="flex items-center gap-2">
                    {signals.some(s => !s.isRead) && (
                      <button onClick={async () => {
                        await fetch("/api/signals", { method: "PATCH", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ all: true }) });
                        setSignals(prev => prev.map(s => ({ ...s, isRead: true })));
                        setUnreadCount(0);
                      }} className="text-[10px] text-slate hover:text-carbon transition-colors">
                        Marcar todo como leído
                      </button>
                    )}
                    <button onClick={() => setBellOpen(false)} className="text-slate hover:text-carbon transition-colors p-0.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Signal list */}
                <div className="max-h-[420px] overflow-y-auto">
                  {loadingBell ? (
                    <div className="flex items-center justify-center py-10">
                      <svg className="animate-spin w-5 h-5 text-slate" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="10"/>
                      </svg>
                    </div>
                  ) : signals.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <p className="text-[28px] mb-2">🔔</p>
                      <p className="text-[13px] font-medium text-carbon">Sin señales aún</p>
                      <p className="text-[11px] text-slate mt-1">Aparecerán aquí cuando el cron detecte actividad</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-chalk">
                      {signals.map(sig => (
                        <Link
                          key={sig.id}
                          href={sig.company ? `/empresa/${sig.company.slug}` : "#"}
                          onClick={() => setBellOpen(false)}
                          className={`flex items-start gap-3 px-4 py-3 hover:bg-fog transition-colors ${!sig.isRead ? "bg-orange/[0.04]" : ""}`}
                        >
                          {/* Unread dot */}
                          <div className="shrink-0 mt-1 w-4 flex items-center justify-center">
                            {!sig.isRead
                              ? <span className="w-2 h-2 rounded-full bg-orange" />
                              : <span className="w-2 h-2 rounded-full bg-transparent" />
                            }
                          </div>

                          {/* Icon */}
                          <span className="text-[18px] shrink-0 mt-0.5 leading-none">
                            {SIGNAL_ICON[sig.type] ?? "📌"}
                          </span>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            {sig.company && (
                              <p className="text-[10px] font-semibold text-orange uppercase tracking-wide truncate">
                                {sig.company.name}
                              </p>
                            )}
                            <p className="text-[12px] font-medium text-carbon leading-snug line-clamp-2">{sig.title}</p>
                            {sig.detail && (
                              <p className="text-[10px] text-slate leading-relaxed mt-0.5 line-clamp-2">{sig.detail}</p>
                            )}
                            <p className="text-[9px] text-slate/60 mt-1">{fmtRelative(sig.date)}</p>
                          </div>

                          {/* Severity dot */}
                          <div className="shrink-0 mt-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full block ${
                              sig.severity === "high" ? "bg-red-500" :
                              sig.severity === "medium" ? "bg-amber-400" : "bg-slate-300"
                            }`} />
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer */}
                {signals.length > 0 && (
                  <div className="border-t border-chalk px-4 py-2.5">
                    <p className="text-[10px] text-slate text-center">
                      Señales de las últimas 30 entradas · El cron actualiza Mon–Fri 8am UTC
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Avatar */}
          <div className="w-7 h-7 rounded-full bg-carbon flex items-center justify-center text-white text-[11px] font-semibold">
            PM
          </div>
        </div>
      </header>

      {/* Chat panel */}
      <ChatPanel
        open={chatOpen}
        initialQuery={initialQuery}
        onClose={() => { setChatOpen(false); setInitialQuery(""); }}
      />
    </>
  );
}
