"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

type Member = { id: string; name: string; email: string; role: string; createdAt: string | null };
type PendingUser = { id: string; name: string; email: string; createdAt: string | null };
type TwoPagerSection = { id: string; title: string; guidance: string };

export default function SettingsPage() {
  const { data: session, update: updateSession } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountMessage, setAccountMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [pending, setPending] = useState<PendingUser[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingBusyId, setPendingBusyId] = useState<string | null>(null);

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState("");
  const [resetMessage, setResetMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [thesis, setThesis] = useState("");
  const [thesisLoading, setThesisLoading] = useState(true);
  const [thesisSaving, setThesisSaving] = useState(false);
  const [thesisMessage, setThesisMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [policy, setPolicy] = useState("");
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyMessage, setPolicyMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [sections, setSections] = useState<TwoPagerSection[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [sectionsSaving, setSectionsSaving] = useState(false);
  const [sectionsMessage, setSectionsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

    async function loadMembers() {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setMembers(data.users);
      }
      setMembersLoading(false);
    }
    loadMembers();
  }, []);

  useEffect(() => {
    if (!isAdmin) { setPendingLoading(false); return; }
    async function loadPending() {
      const res = await fetch("/api/admin/pending-users");
      if (res.ok) {
        const data = await res.json();
        setPending(data.users);
      }
      setPendingLoading(false);
    }
    loadPending();

    async function loadThesis() {
      const res = await fetch("/api/admin/firm-thesis");
      if (res.ok) {
        const data = await res.json();
        setThesis(data.thesis);
      }
      setThesisLoading(false);
    }
    loadThesis();

    async function loadPolicy() {
      const res = await fetch("/api/admin/twopager-policy");
      if (res.ok) {
        const data = await res.json();
        setPolicy(data.policy);
      }
      setPolicyLoading(false);
    }
    loadPolicy();

    async function loadSections() {
      const res = await fetch("/api/admin/twopager-sections");
      if (res.ok) {
        const data = await res.json();
        setSections(data.sections);
      }
      setSectionsLoading(false);
    }
    loadSections();
  }, [isAdmin]);

  async function handlePolicySave() {
    setPolicyMessage(null);
    if (!policy.trim()) {
      setPolicyMessage({ type: "error", text: "Policy text cannot be empty" });
      return;
    }
    setPolicySaving(true);
    const res = await fetch("/api/admin/twopager-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setPolicy(data.policy);
      setPolicyMessage({ type: "success", text: "2-Pager policy updated" });
    } else {
      setPolicyMessage({ type: "error", text: data.error ?? "Could not save policy" });
    }
    setPolicySaving(false);
  }

  function updateSection(idx: number, patch: Partial<TwoPagerSection>) {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }
  function removeSection(idx: number) {
    setSections(prev => prev.filter((_, i) => i !== idx));
  }
  function moveSection(idx: number, dir: -1 | 1) {
    setSections(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function addSection() {
    setSections(prev => [...prev, { id: crypto.randomUUID(), title: "New Section", guidance: "" }]);
  }

  async function handleSectionsSave() {
    setSectionsMessage(null);
    if (sections.length === 0 || sections.some(s => !s.title.trim())) {
      setSectionsMessage({ type: "error", text: "Every section needs a title" });
      return;
    }
    setSectionsSaving(true);
    const res = await fetch("/api/admin/twopager-sections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setSections(data.sections);
      setSectionsMessage({ type: "success", text: "2-Pager default structure updated" });
    } else {
      setSectionsMessage({ type: "error", text: data.error ?? "Could not save structure" });
    }
    setSectionsSaving(false);
  }

  async function handleThesisSave() {
    setThesisMessage(null);
    if (!thesis.trim()) {
      setThesisMessage({ type: "error", text: "Thesis text cannot be empty" });
      return;
    }
    setThesisSaving(true);
    const res = await fetch("/api/admin/firm-thesis", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thesis }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setThesis(data.thesis);
      setThesisMessage({ type: "success", text: "Investment thesis updated — used by the scan cron and document scanner" });
    } else {
      setThesisMessage({ type: "error", text: data.error ?? "Could not save thesis" });
    }
    setThesisSaving(false);
  }

  async function handlePendingAction(id: string, action: "approve" | "decline") {
    setPendingBusyId(id);
    const res = await fetch(`/api/admin/pending-users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      const approved = pending.find(p => p.id === id);
      setPending(prev => prev.filter(p => p.id !== id));
      if (action === "approve" && approved) {
        setMembers(prev => [{ id: approved.id, name: approved.name, email: approved.email, role: "analyst", createdAt: approved.createdAt }, ...prev]);
      }
    }
    setPendingBusyId(null);
  }

  async function handleResetPassword(id: string) {
    if (resetValue.length < 8) {
      setResetMessage({ type: "error", text: "Password must be at least 8 characters" });
      return;
    }
    const res = await fetch(`/api/admin/users/${id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: resetValue }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setResetMessage({ type: "success", text: "Password updated — share it with them securely" });
      setResetValue("");
    } else {
      setResetMessage({ type: "error", text: data.error ?? "Could not reset password" });
    }
  }

  async function handleAccountSave() {
    setAccountMessage(null);
    if (!currentPassword) {
      setAccountMessage({ type: "error", text: "Enter your current password to confirm changes" });
      return;
    }
    if (!newEmail.trim() && !newPassword.trim()) {
      setAccountMessage({ type: "error", text: "Enter a new email and/or new password" });
      return;
    }

    setSavingAccount(true);
    const res = await fetch("/api/user/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword,
        newEmail: newEmail.trim() || undefined,
        newPassword: newPassword.trim() || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      setAccountMessage({ type: "success", text: "Account updated successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setNewEmail("");
      await updateSession({ email: data.email });
      setMembers(prev => prev.map(m => m.id === session?.user?.id ? { ...m, email: data.email } : m));
    } else {
      setAccountMessage({ type: "error", text: data.error ?? "Could not update account" });
    }
    setSavingAccount(false);
  }

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

        {/* Account section */}
        <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-4 mb-8">
          <div>
            <h2 className="text-[16px] font-semibold text-carbon">Account</h2>
            <p className="text-[12px] text-slate mt-1">
              Signed in as <span className="font-medium text-carbon">{session?.user?.email}</span>
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-graphite mb-1.5">New email</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="Leave empty to keep current"
                className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-graphite mb-1.5">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Leave empty to keep current"
                className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-graphite mb-1.5">Current password (required to confirm)</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-orange"
            />
          </div>

          {accountMessage && (
            <div className={`rounded-[8px] p-3 text-[12px] border ${
              accountMessage.type === "success"
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-red-50 text-red-700 border-red-200"
            }`}>
              {accountMessage.text}
            </div>
          )}

          <button
            onClick={handleAccountSave}
            disabled={savingAccount}
            className="py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {savingAccount ? "Saving…" : "Update Account"}
          </button>
        </div>

        {/* Pending Requests (admin only) */}
        {isAdmin && (
          <div className="bg-white border border-chalk rounded-[12px] p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-semibold text-carbon">Pending Requests</h2>
              <span className="text-[11px] text-slate">{pending.length} waiting</span>
            </div>

            {pendingLoading ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
            ) : pending.length === 0 ? (
              <div className="text-[12px] text-slate">No pending join requests.</div>
            ) : (
              <div className="divide-y divide-chalk">
                {pending.map(p => (
                  <div key={p.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-[13px] font-medium text-carbon">{p.name}</div>
                      <div className="text-[12px] text-slate">{p.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePendingAction(p.id, "approve")}
                        disabled={pendingBusyId === p.id}
                        className="px-3 py-1.5 bg-orange text-white rounded-[8px] text-[12px] font-medium hover:opacity-85 disabled:opacity-40 transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handlePendingAction(p.id, "decline")}
                        disabled={pendingBusyId === p.id}
                        className="px-3 py-1.5 border border-red-300 text-red-700 rounded-[8px] text-[12px] font-medium hover:bg-red-50 disabled:opacity-40 transition-colors"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Investment Thesis (admin only) */}
        {isAdmin && (
          <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-4 mb-8">
            <div>
              <h2 className="text-[16px] font-semibold text-carbon">Investment Thesis</h2>
              <p className="text-[12px] text-slate mt-1">
                Pando's investment policy, used by the discovery cron and the "Scan document with AI" feature
                to score how well a company fits the fund's mandate.
              </p>
            </div>

            {thesisLoading ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
            ) : (
              <textarea
                value={thesis}
                onChange={e => setThesis(e.target.value)}
                rows={16}
                className="w-full px-3 py-2.5 text-[12px] leading-relaxed bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange font-mono"
              />
            )}

            {thesisMessage && (
              <div className={`rounded-[8px] p-3 text-[12px] border ${
                thesisMessage.type === "success"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {thesisMessage.text}
              </div>
            )}

            <button
              onClick={handleThesisSave}
              disabled={thesisSaving || thesisLoading}
              className="py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {thesisSaving ? "Saving…" : "Save Thesis"}
            </button>
          </div>
        )}

        {/* 2-Pager Investment Policy (admin only) */}
        {isAdmin && (
          <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-4 mb-8">
            <div>
              <h2 className="text-[16px] font-semibold text-carbon">2-Pager Investment Policy</h2>
              <p className="text-[12px] text-slate mt-1">
                Tone, emphasis, and formatting guidance for the Company 2-Pager document type
                (separate from the Investment Thesis used for company scoring).
              </p>
            </div>

            {policyLoading ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
            ) : (
              <textarea
                value={policy}
                onChange={e => setPolicy(e.target.value)}
                rows={12}
                className="w-full px-3 py-2.5 text-[12px] leading-relaxed bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange font-mono"
              />
            )}

            {policyMessage && (
              <div className={`rounded-[8px] p-3 text-[12px] border ${
                policyMessage.type === "success"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {policyMessage.text}
              </div>
            )}

            <button
              onClick={handlePolicySave}
              disabled={policySaving || policyLoading}
              className="py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {policySaving ? "Saving…" : "Save Policy"}
            </button>
          </div>
        )}

        {/* 2-Pager Default Structure (admin only) */}
        {isAdmin && (
          <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-4 mb-8">
            <div>
              <h2 className="text-[16px] font-semibold text-carbon">2-Pager Default Structure</h2>
              <p className="text-[12px] text-slate mt-1">
                Default section outline for the Company 2-Pager. Each user can still edit their own copy
                of this outline when building a specific document.
              </p>
            </div>

            {sectionsLoading ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
            ) : (
              <div className="space-y-3">
                {sections.map((s, idx) => (
                  <div key={s.id} className="border border-chalk rounded-[8px] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={s.title}
                        onChange={e => updateSection(idx, { title: e.target.value })}
                        placeholder="Section title"
                        className="flex-1 px-3 py-2 text-[12px] font-medium bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-orange"
                      />
                      <button
                        onClick={() => moveSection(idx, -1)}
                        disabled={idx === 0}
                        className="px-2 py-2 text-slate hover:text-carbon disabled:opacity-30 text-[12px]"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveSection(idx, 1)}
                        disabled={idx === sections.length - 1}
                        className="px-2 py-2 text-slate hover:text-carbon disabled:opacity-30 text-[12px]"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeSection(idx)}
                        className="px-2 py-2 text-red-500 hover:text-red-700 text-[12px]"
                        title="Remove section"
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      value={s.guidance}
                      onChange={e => updateSection(idx, { guidance: e.target.value })}
                      placeholder="Guidance for what this section should cover"
                      rows={2}
                      className="w-full px-3 py-2 text-[11px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange"
                    />
                  </div>
                ))}

                <button
                  onClick={addSection}
                  className="w-full py-2 border border-dashed border-chalk rounded-[8px] text-[12px] text-slate hover:text-carbon hover:border-graphite transition-colors"
                >
                  + Add Section
                </button>
              </div>
            )}

            {sectionsMessage && (
              <div className={`rounded-[8px] p-3 text-[12px] border ${
                sectionsMessage.type === "success"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {sectionsMessage.text}
              </div>
            )}

            <button
              onClick={handleSectionsSave}
              disabled={sectionsSaving || sectionsLoading}
              className="py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {sectionsSaving ? "Saving…" : "Save Structure"}
            </button>
          </div>
        )}

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

        {/* Members */}
        <div className="mt-8 bg-white border border-chalk rounded-[12px] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-carbon">Team Members</h3>
            <span className="text-[11px] text-slate">{members.length} joined</span>
          </div>

          {membersLoading ? (
            <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
          ) : (
            <div className="divide-y divide-chalk">
              {members.map(m => (
                <div key={m.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[13px] font-medium text-carbon">{m.name}</div>
                      <div className="text-[12px] text-slate">{m.email}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-medium text-graphite bg-fog px-2 py-1 rounded-full capitalize">{m.role}</span>
                      {m.createdAt && (
                        <span className="text-[11px] text-slate">
                          Joined {new Date(m.createdAt).toLocaleDateString()}
                        </span>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => {
                            setResettingId(resettingId === m.id ? null : m.id);
                            setResetValue("");
                            setResetMessage(null);
                          }}
                          className="text-[11px] font-medium text-carbon hover:underline"
                        >
                          {resettingId === m.id ? "Cancel" : "Reset Password"}
                        </button>
                      )}
                    </div>
                  </div>

                  {resettingId === m.id && (
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="text"
                        value={resetValue}
                        onChange={e => setResetValue(e.target.value)}
                        placeholder="New password (min 8 chars)"
                        className="flex-1 px-3 py-2 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange"
                      />
                      <button
                        onClick={() => handleResetPassword(m.id)}
                        className="px-3 py-2 bg-orange text-white rounded-[8px] text-[12px] font-medium hover:opacity-85 transition-colors"
                      >
                        Set Password
                      </button>
                    </div>
                  )}
                  {resettingId === m.id && resetMessage && (
                    <div className={`mt-2 rounded-[8px] p-2 text-[11px] border ${
                      resetMessage.type === "success"
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-red-50 text-red-700 border-red-200"
                    }`}>
                      {resetMessage.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
