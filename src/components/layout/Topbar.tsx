"use client";
import { useState } from "react";
import { ChatPanel } from "./ChatPanel";

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Topbar({ title, subtitle, actions }: TopbarProps) {
  const [query, setQuery]         = useState("");
  const [chatOpen, setChatOpen]   = useState(false);
  const [initialQuery, setInitialQuery] = useState("");

  function openChat(q?: string) {
    const text = q ?? query;
    setInitialQuery(text);
    setChatOpen(true);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim()) {
      openChat();
    }
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
          <button
            onClick={() => openChat("")}
            className="relative w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-fog text-slate hover:text-carbon transition-colors"
            title="Abrir PANDO AI"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 1C3.91 1 1 3.69 1 7c0 1.47.56 2.82 1.5 3.87L1.5 14l3.5-1.5C6.1 13 6.79 13 7.5 13c3.59 0 6.5-2.69 6.5-6S11.09 1 7.5 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-green-500 rounded-full" />
          </button>
          {/* Notifications bell */}
          <button className="relative w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-fog text-slate hover:text-carbon transition-colors">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 1.5A4.5 4.5 0 003 6v3l-1.5 2h12L12 9V6A4.5 4.5 0 007.5 1.5z" stroke="currentColor" strokeWidth="1.2" />
              <path d="M6.3 12.5a1.2 1.2 0 002.4 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-orange rounded-full pulse-dot" />
          </button>
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
