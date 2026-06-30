"use client";
import { useState, useEffect } from "react";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/user/api-key");
      if (res.ok) {
        const data = await res.json();
        setHasKey(data.hasApiKey);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    if (!apiKey.trim()) {
      setMessage({ type: "error", text: "Enter a valid API key" });
      return;
    }
    setSaving(true);
    setMessage(null);

    const res = await fetch("/api/user/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
    });

    if (res.ok) {
      setHasKey(true);
      setMessage({ type: "success", text: "✓ API key saved successfully" });
      setApiKey("");
    } else {
      const err = await res.json().catch(() => ({}));
      setMessage({ type: "error", text: (err as any).error ?? "Error saving key" });
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirm("Delete your API key? You'll need to add a new one to use AI features.")) return;
    const res = await fetch("/api/user/api-key", { method: "DELETE" });
    if (res.ok) {
      setHasKey(false);
      setMessage({ type: "success", text: "API key deleted" });
    }
  }

  return (
    <div className="min-h-screen bg-mist p-8">
      <div>

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-[28px] font-semibold text-carbon mb-2">Settings</h1>
          <p className="text-[13px] text-slate">Manage your Anthropic API key to use AI features</p>
        </div>

        {/* API Key section */}
        <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-6">

          <div>
            <div className="flex items-start justify-between mb-2">
              <h2 className="text-[16px] font-semibold text-carbon">Anthropic API Key</h2>
              {hasKey && (
                <span className="text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
                  ✓ Configured
                </span>
              )}
            </div>
            <p className="text-[12px] text-slate leading-relaxed">
              Your API key is used exclusively in your account to generate documents with AI.
              Each user must have their own Anthropic key.
              <a href="https://console.anthropic.com/keys" target="_blank" rel="noopener noreferrer" className="text-carbon font-semibold hover:underline ml-1">
                Get your API key here →
              </a>
            </p>
          </div>

          {/* Status info */}
          {loading ? (
            <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
          ) : (
            <>
              {hasKey && !apiKey && (
                <div className="bg-green-50 border border-green-200 rounded-[8px] p-4">
                  <div className="text-[12px] text-green-700 font-medium">
                    ✓ You have an API key saved
                  </div>
                  <div className="text-[11px] text-green-600 mt-1">
                    You can use it to generate documents with backup files and AI.
                  </div>
                </div>
              )}

              {!hasKey && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-[8px] p-4">
                  <div className="text-[12px] text-yellow-800 font-medium">
                    ⚠ No API key configured
                  </div>
                  <div className="text-[11px] text-yellow-700 mt-1">
                    You need to add your API key to use AI document generation.
                  </div>
                </div>
              )}
            </>
          )}

          {/* Input section */}
          <div className="space-y-3">
            <label className="block text-[12px] font-semibold text-carbon">
              {hasKey && !apiKey ? "Update" : "Add"} API Key
            </label>

            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={hasKey && !apiKey ? "Leave empty to keep current key" : "sk-ant-..."}
                className="w-full border border-chalk rounded-[8px] px-4 py-2.5 text-[13px] text-carbon placeholder:text-slate/50 focus:outline-none focus:border-orange font-mono"
              />
              {apiKey && (
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate hover:text-carbon text-[12px] font-medium"
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              )}
            </div>

            <div className="text-[10px] text-slate">
              • The key is stored securely in your local database
              <br />
              • Used only in your account to generate documents
              <br />
              • Never sent to external servers or shared
            </div>
          </div>

          {/* Messages */}
          {message && (
            <div className={`rounded-[8px] p-3 text-[12px] border ${
              message.type === "success"
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-red-50 text-red-700 border-red-200"
            }`}>
              {message.text}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !apiKey.trim()}
              className="flex-1 py-2.5 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : "Save API Key"}
            </button>

            {hasKey && (
              <button
                onClick={handleDelete}
                className="px-4 py-2.5 border border-red-300 text-red-700 rounded-[8px] text-[13px] font-medium hover:bg-red-50 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* How it works */}
        <div className="mt-8 bg-white border border-chalk rounded-[12px] p-6">
          <h3 className="text-[14px] font-semibold text-carbon mb-4">How it works</h3>

          <div className="space-y-4">
            {[
              {
                n: "1",
                title: "Get your API Key",
                desc: "Go to console.anthropic.com, create a free account and generate your API key in the keys section.",
              },
              {
                n: "2",
                title: "Add it here",
                desc: "Copy your API key (it starts with 'sk-ant-') and paste it in the field above.",
              },
              {
                n: "3",
                title: "Use in documents",
                desc: "When generating documents with backup files or custom instructions, AI will use your API key.",
              },
              {
                n: "4",
                title: "Yours only",
                desc: "Your API key only works in your account and is never shared with other users.",
              },
            ].map((item) => (
              <div key={item.n} className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-orange text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                  {item.n}
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-carbon">{item.title}</div>
                  <div className="text-[11px] text-slate mt-0.5">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing note */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-[12px] p-4">
          <div className="text-[12px] text-blue-700 leading-relaxed">
            <strong>Note:</strong> Anthropic offers $5 USD in free credits per month for new accounts.
            If you need more, pay-as-you-go plans are available.
            <a href="https://docs.anthropic.com/en/api/overview" target="_blank" rel="noopener noreferrer" className="block text-blue-600 font-semibold hover:underline mt-1.5">
              View pricing documentation →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
