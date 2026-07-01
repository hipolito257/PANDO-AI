"use client";
import { useState, useEffect } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";

type Source = {
  id: string;
  name: string;
  displayName: string;
  category: string;
  isSubscribed: boolean;
  isEnabled: boolean;
  description: string | null;
  website: string | null;
  logoColor: string | null;
  costType: string;
  requiresApiKey: boolean;
  accessHint: string | null;
  apiKeyConfigured: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  financial:    "Financial & Market Data",
  intelligence: "Business Intelligence",
  news:         "News & Media",
  registry:     "Public Records",
  alternative:  "Alternative Data",
};
const CATEGORY_ORDER = ["financial", "intelligence", "news", "registry", "alternative"];

const COST: Record<string, { label: string; pill: string }> = {
  free:     { label: "Free",     pill: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  freemium: { label: "Freemium", pill: "bg-amber-50 text-amber-700 border border-amber-200"       },
  paid:     { label: "Paid",     pill: "bg-slate-100 text-slate-600 border border-slate-200"       },
};

export default function ConectoresPage() {
  const [sources, setSources]   = useState<Source[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/conectores")
      .then(r => r.json())
      .then(d => { setSources(d); setLoading(false); });
  }, []);

  const [syncing,   setSyncing]   = useState<string | null>(null);
  const [syncResult,setSyncResult]= useState<Record<string, string>>({});

  async function syncNews() {
    setSyncing("google_news");
    const res = await fetch("/api/sync/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setSyncResult(prev => ({ ...prev, google_news: `+${data.totalAdded} new articles across ${data.report?.length ?? 0} companies` }));
    setSyncing(null);
  }

  async function patch(id: string, update: Record<string, unknown>) {
    setSaving(id);
    const res  = await fetch("/api/conectores", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...update }),
    });
    const data = await res.json();
    setSources(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
    setSaving(null);
  }

  const grouped = CATEGORY_ORDER
    .map(cat => ({ cat, label: CATEGORY_LABELS[cat], items: sources.filter(s => s.category === cat) }))
    .filter(g => g.items.length > 0);

  const enabled    = sources.filter(s => s.isEnabled).length;
  const configured = sources.filter(s => s.apiKeyConfigured || !s.requiresApiKey).length;
  const free       = sources.filter(s => s.costType === "free").length;

  return (
    <div>
      <Topbar title="Connectors" subtitle={`${enabled} active · ${configured} of ${sources.length} configured`} />

      <div className="p-6 space-y-6">

        {/* Banner */}
        <div className="bg-[#fff4f0] border border-[#ffd5c4] rounded-[8px] p-4 flex gap-3">
          <div className="w-5 h-5 rounded-full bg-orange flex items-center justify-center text-white text-[10px] font-bold flex-none mt-0.5">!</div>
          <div>
            <p className="text-[13px] font-semibold text-carbon mb-0.5">PANDO works with any combination of sources</p>
            <p className="text-[12px] text-graphite leading-relaxed">
              Enable only the ones you already have. The <strong>{free} free sources</strong> (Google News, SAT, public records, media)
              are available at no cost and require no setup.
              Paid sources require you to paste your API key for PANDO to use them.
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[11px]">
          <span className="text-slate font-medium uppercase tracking-wide">Cost:</span>
          {Object.entries(COST).map(([k, v]) => (
            <span key={k} className={`px-2.5 py-0.5 rounded-full font-medium ${v.pill}`}>{v.label}</span>
          ))}
          <span className="ml-4 text-slate font-medium uppercase tracking-wide">Status:</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Active in PANDO</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-chalk" />Inactive</span>
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate text-[13px]">Loading...</div>
        ) : (
          <div className="space-y-8">
            {grouped.map(({ cat, label, items }) => (
              <div key={cat}>
                <h2 className="text-[11px] font-semibold text-slate uppercase tracking-wider mb-3">
                  {label} <span className="text-chalk font-normal normal-case">({items.length})</span>
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  {items.map(src => (
                    <SourceCard
                      key={src.id}
                      source={src}
                      saving={saving === src.id}
                      onPatch={update => patch(src.id, update)}
                      onSync={src.name === "google_news" ? syncNews : undefined}
                      syncing={syncing === src.name}
                      syncResult={syncResult[src.name]}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SourceCard ─────────────────────────────────────────────────────────────────

function SourceCard({
  source, saving, onPatch, onSync, syncing, syncResult,
}: {
  source:      Source;
  saving:      boolean;
  onPatch:     (u: Record<string, unknown>) => void;
  onSync?:     () => void;
  syncing?:    boolean;
  syncResult?: string;
}) {
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyValue,     setKeyValue]     = useState("");
  const [showKey,      setShowKey]      = useState(false);

  const color    = source.logoColor ?? "#828282";
  const cost     = COST[source.costType] ?? COST.paid;
  const canEnable = !source.requiresApiKey || source.isSubscribed;

  function saveApiKey() {
    onPatch({ apiKey: keyValue });
    setShowKeyInput(false);
    setKeyValue("");
  }

  return (
    <Card padding="none" className={`flex flex-col transition-all ${!source.isEnabled ? "opacity-60" : ""}`}>

      {/* ── Header ── */}
      <div className="p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-[8px] flex-none flex items-center justify-center text-white text-[11px] font-bold"
          style={{ background: color }}>
          {source.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-carbon">{source.displayName}</span>
            <span className={`w-2 h-2 rounded-full flex-none ${source.isEnabled ? "bg-emerald-500" : "bg-chalk"}`} />
          </div>
          {source.website && (
            <a href={source.website} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-slate hover:text-orange transition-colors truncate block">
              {source.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-none ${cost.pill}`}>
          {cost.label}
        </span>
      </div>

      {/* ── Description ── */}
      {source.description && (
        <p className="px-4 pb-3 text-[11px] text-graphite leading-relaxed border-b border-chalk">
          {source.description}
        </p>
      )}

      {/* ── How to get it / what it costs ── */}
      <div className="px-4 py-3 border-b border-chalk bg-fog/40">
        <p className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-1">
          {source.requiresApiKey ? "How to get access" : "Availability"}
        </p>
        <p className="text-[11px] text-graphite leading-snug">
          {source.accessHint ?? "—"}
        </p>
      </div>

      {/* ── API Key section (only for sources that require it) ── */}
      {source.requiresApiKey && (
        <div className="px-4 py-3 border-b border-chalk">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-carbon">API Key / Credentials</p>
            {source.apiKeyConfigured ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-700 font-medium bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Configured
              </span>
            ) : (
              <span className="text-[10px] text-slate bg-chalk px-2 py-0.5 rounded-full">
                Not configured
              </span>
            )}
          </div>

          {!showKeyInput ? (
            <button
              onClick={() => setShowKeyInput(true)}
              className="w-full text-[11px] text-graphite border border-dashed border-chalk rounded-[6px] py-2 px-3 text-left hover:border-carbon hover:text-carbon transition-colors"
            >
              {source.apiKeyConfigured
                ? "🔑 Change API key..."
                : "＋ Paste API key or token..."}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={keyValue}
                  onChange={e => setKeyValue(e.target.value)}
                  placeholder="Paste your API key here..."
                  className="w-full text-[12px] bg-fog border border-chalk rounded-[6px] px-3 py-2 pr-10 focus:outline-none focus:border-carbon font-mono"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate hover:text-carbon"
                  title={showKey ? "Hide" : "Show"}
                >
                  {showKey ? (
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveApiKey}
                  disabled={!keyValue.trim() || saving}
                  className="flex-1 text-[11px] font-medium bg-carbon text-white rounded-[6px] py-1.5 hover:opacity-85 disabled:opacity-40 transition-opacity"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => { setShowKeyInput(false); setKeyValue(""); }}
                  className="flex-1 text-[11px] font-medium bg-fog border border-chalk text-graphite rounded-[6px] py-1.5 hover:border-carbon transition-colors"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-slate">The key is stored locally, accessible only to the firm's team.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Sync button (sources with a sync action) ── */}
      {onSync && source.isEnabled && (
        <div className="px-4 py-3 border-b border-chalk">
          <button
            onClick={onSync}
            disabled={syncing}
            className="w-full flex items-center justify-center gap-2 py-2 text-[12px] font-medium bg-carbon text-white rounded-[8px] hover:opacity-85 disabled:opacity-50 transition-opacity"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={syncing ? "animate-spin" : ""}>
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            {syncing ? "Syncing all companies..." : "Sync news now"}
          </button>
          {syncResult && (
            <p className="text-[10px] text-emerald-700 text-center mt-1.5 font-medium">{syncResult}</p>
          )}
        </div>
      )}

      {/* ── Toggles ── */}
      <div className="px-4 py-3 space-y-3">

        {/* Toggle: I have access */}
        {source.requiresApiKey && (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-carbon">I have a subscription</p>
              <p className="text-[10px] text-slate mt-0.5">Confirms the firm has an active subscription</p>
            </div>
            <Toggle
              value={source.isSubscribed}
              disabled={saving}
              onChange={v => onPatch({ isSubscribed: v })}
            />
          </div>
        )}

        {/* Toggle: Enabled in PANDO */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`text-[12px] font-medium ${canEnable ? "text-carbon" : "text-slate"}`}>
              Use in PANDO
            </p>
            <p className="text-[10px] text-slate mt-0.5">
              {canEnable
                ? "PANDO includes this source in signals and radar"
                : "Enable 'I have a subscription' first"}
            </p>
          </div>
          <Toggle
            value={source.isEnabled}
            disabled={saving || !canEnable}
            onChange={v => onPatch({ isEnabled: v })}
          />
        </div>
      </div>
    </Card>
  );
}

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }: {
  value:    boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`relative w-9 rounded-full transition-colors flex-none
        ${value ? "bg-carbon" : "bg-chalk"}
        ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
      style={{ height: "20px" }}
    >
      <span className={`absolute top-[3px] w-[14px] h-[14px] bg-white rounded-full shadow-sm transition-transform
        ${value ? "translate-x-[19px]" : "translate-x-[3px]"}`}
      />
    </button>
  );
}
