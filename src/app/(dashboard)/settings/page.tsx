"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

type Member = { id: string; name: string; email: string; role: string; createdAt: string | null };
type PendingUser = { id: string; name: string; email: string; createdAt: string | null };
type TwoPagerSection = { id: string; title: string; guidance: string };
type IrlSection = { id: string; title: string; guidance: string };
type IrlQuestion = { id: string; category: string; question: string };

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

  const [cronEnabled, setCronEnabled] = useState(true);
  const [cronLoading, setCronLoading] = useState(true);
  const [cronSaving, setCronSaving] = useState(false);
  const [cronMessage, setCronMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [thesis, setThesis] = useState("");
  const [thesisFileName, setThesisFileName] = useState<string | null>(null);
  const [thesisLoading, setThesisLoading] = useState(true);
  const [thesisUploading, setThesisUploading] = useState(false);
  const [thesisMessage, setThesisMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [sections, setSections] = useState<TwoPagerSection[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [sectionsSaving, setSectionsSaving] = useState(false);
  const [sectionsMessage, setSectionsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateUploading, setTemplateUploading] = useState(false);
  const [templateMessage, setTemplateMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [irlSections, setIrlSections] = useState<IrlSection[]>([]);
  const [irlSectionsLoading, setIrlSectionsLoading] = useState(true);
  const [irlSectionsSaving, setIrlSectionsSaving] = useState(false);
  const [irlSectionsMessage, setIrlSectionsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [irlQuestions, setIrlQuestions] = useState<IrlQuestion[]>([]);
  const [irlQuestionsLoading, setIrlQuestionsLoading] = useState(true);
  const [irlQuestionsSaving, setIrlQuestionsSaving] = useState(false);
  const [irlQuestionsMessage, setIrlQuestionsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [irlTemplateName, setIrlTemplateName] = useState<string | null>(null);
  const [irlTemplateLoading, setIrlTemplateLoading] = useState(true);
  const [irlTemplateUploading, setIrlTemplateUploading] = useState(false);
  const [irlTemplateMessage, setIrlTemplateMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

    async function loadCronSettings() {
      const res = await fetch("/api/admin/cron-settings");
      if (res.ok) {
        const data = await res.json();
        setCronEnabled(data.enabled);
      }
      setCronLoading(false);
    }
    loadCronSettings();

    async function loadThesis() {
      const res = await fetch("/api/admin/firm-thesis");
      if (res.ok) {
        const data = await res.json();
        setThesis(data.thesis);
        setThesisFileName(data.fileName);
      }
      setThesisLoading(false);
    }
    loadThesis();

    async function loadSections() {
      const res = await fetch("/api/admin/twopager-sections");
      if (res.ok) {
        const data = await res.json();
        setSections(data.sections);
      }
      setSectionsLoading(false);
    }
    loadSections();

    async function loadTemplate() {
      const res = await fetch("/api/admin/twopager-template");
      if (res.ok) {
        const data = await res.json();
        setTemplateName(data.name);
      }
      setTemplateLoading(false);
    }
    loadTemplate();

    async function loadIrlSections() {
      const res = await fetch("/api/admin/irl-sections");
      if (res.ok) {
        const data = await res.json();
        setIrlSections(data.sections);
      }
      setIrlSectionsLoading(false);
    }
    loadIrlSections();

    async function loadIrlQuestions() {
      const res = await fetch("/api/admin/irl-questionnaire");
      if (res.ok) {
        const data = await res.json();
        setIrlQuestions(data.questions);
      }
      setIrlQuestionsLoading(false);
    }
    loadIrlQuestions();

    async function loadIrlTemplate() {
      const res = await fetch("/api/admin/irl-template");
      if (res.ok) {
        const data = await res.json();
        setIrlTemplateName(data.name);
      }
      setIrlTemplateLoading(false);
    }
    loadIrlTemplate();
  }, [isAdmin]);

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

  function updateIrlSection(idx: number, patch: Partial<IrlSection>) {
    setIrlSections(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }
  function removeIrlSection(idx: number) {
    setIrlSections(prev => prev.filter((_, i) => i !== idx));
  }
  function moveIrlSection(idx: number, dir: -1 | 1) {
    setIrlSections(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function addIrlSection() {
    setIrlSections(prev => [...prev, { id: crypto.randomUUID(), title: "New Section", guidance: "" }]);
  }

  function updateIrlQuestion(idx: number, patch: Partial<IrlQuestion>) {
    setIrlQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...patch } : q));
  }
  function removeIrlQuestion(idx: number) {
    setIrlQuestions(prev => prev.filter((_, i) => i !== idx));
  }
  function moveIrlQuestion(idx: number, dir: -1 | 1) {
    setIrlQuestions(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function addIrlQuestion() {
    setIrlQuestions(prev => [...prev, { id: crypto.randomUUID(), category: "Market", question: "" }]);
  }

  async function handleCronToggle() {
    const next = !cronEnabled;
    setCronMessage(null);
    setCronSaving(true);
    const res = await fetch("/api/admin/cron-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setCronEnabled(data.enabled);
      setCronMessage({ type: "success", text: data.enabled ? "Daily cron re-enabled" : "Daily cron paused" });
    } else {
      setCronMessage({ type: "error", text: data.error ?? "Could not update cron setting" });
    }
    setCronSaving(false);
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

  async function handleTemplateUpload(file: File) {
    setTemplateMessage(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "docx") {
      setTemplateMessage({ type: "error", text: "Please upload a .docx file" });
      return;
    }
    setTemplateUploading(true);
    try {
      const CHUNK_SIZE = 3 * 1024 * 1024;
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const chunkUrls: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const fd = new FormData();
        fd.append("chunk", chunk);
        fd.append("uploadId", uploadId);
        fd.append("chunkIndex", String(i));
        fd.append("filename", file.name);
        const res = await fetch("/api/templates/chunk", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`Part ${i + 1}/${totalChunks} failed (HTTP ${res.status})`);
        const { chunkUrl } = await res.json();
        chunkUrls.push(chunkUrl);
      }

      const finalRes = await fetch("/api/templates/chunk/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkUrls, filename: file.name }),
      });
      if (!finalRes.ok) {
        const j = await finalRes.json().catch(() => ({}));
        throw new Error(j.error ?? "Error assembling file");
      }
      const { blobUrl } = await finalRes.json();

      const regRes = await fetch("/api/admin/twopager-template", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blobUrl, name: file.name }),
      });
      const data = await regRes.json().catch(() => ({}));
      if (!regRes.ok) throw new Error(data.error ?? "Error saving template");

      setTemplateName(data.name);
      setTemplateMessage({ type: "success", text: "2-Pager template updated" });
    } catch (e) {
      setTemplateMessage({ type: "error", text: e instanceof Error ? e.message : "Upload failed" });
    }
    setTemplateUploading(false);
  }

  async function handleIrlSectionsSave() {
    setIrlSectionsMessage(null);
    if (irlSections.length === 0 || irlSections.some(s => !s.title.trim())) {
      setIrlSectionsMessage({ type: "error", text: "Every section needs a title" });
      return;
    }
    setIrlSectionsSaving(true);
    const res = await fetch("/api/admin/irl-sections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: irlSections }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setIrlSections(data.sections);
      setIrlSectionsMessage({ type: "success", text: "IRL default structure updated" });
    } else {
      setIrlSectionsMessage({ type: "error", text: data.error ?? "Could not save structure" });
    }
    setIrlSectionsSaving(false);
  }

  async function handleIrlQuestionsSave() {
    setIrlQuestionsMessage(null);
    if (irlQuestions.length === 0 || irlQuestions.some(q => !q.question.trim() || !q.category.trim())) {
      setIrlQuestionsMessage({ type: "error", text: "Every question needs a category and text" });
      return;
    }
    setIrlQuestionsSaving(true);
    const res = await fetch("/api/admin/irl-questionnaire", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: irlQuestions }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setIrlQuestions(data.questions);
      setIrlQuestionsMessage({ type: "success", text: "IRL questionnaire updated" });
    } else {
      setIrlQuestionsMessage({ type: "error", text: data.error ?? "Could not save questionnaire" });
    }
    setIrlQuestionsSaving(false);
  }

  async function handleIrlTemplateUpload(file: File) {
    setIrlTemplateMessage(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "docx") {
      setIrlTemplateMessage({ type: "error", text: "Please upload a .docx file" });
      return;
    }
    setIrlTemplateUploading(true);
    try {
      const CHUNK_SIZE = 3 * 1024 * 1024;
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const chunkUrls: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const fd = new FormData();
        fd.append("chunk", chunk);
        fd.append("uploadId", uploadId);
        fd.append("chunkIndex", String(i));
        fd.append("filename", file.name);
        const res = await fetch("/api/templates/chunk", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`Part ${i + 1}/${totalChunks} failed (HTTP ${res.status})`);
        const { chunkUrl } = await res.json();
        chunkUrls.push(chunkUrl);
      }

      const finalRes = await fetch("/api/templates/chunk/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkUrls, filename: file.name }),
      });
      if (!finalRes.ok) {
        const j = await finalRes.json().catch(() => ({}));
        throw new Error(j.error ?? "Error assembling file");
      }
      const { blobUrl } = await finalRes.json();

      const regRes = await fetch("/api/admin/irl-template", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blobUrl, name: file.name }),
      });
      const data = await regRes.json().catch(() => ({}));
      if (!regRes.ok) throw new Error(data.error ?? "Error saving template");

      setIrlTemplateName(data.name);
      setIrlTemplateMessage({ type: "success", text: "IRL template updated" });
    } catch (e) {
      setIrlTemplateMessage({ type: "error", text: e instanceof Error ? e.message : "Upload failed" });
    }
    setIrlTemplateUploading(false);
  }

  async function handleThesisUpload(file: File) {
    setThesisMessage(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "docx") {
      setThesisMessage({ type: "error", text: "Please upload a .docx file" });
      return;
    }
    setThesisUploading(true);
    try {
      const CHUNK_SIZE = 3 * 1024 * 1024;
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const chunkUrls: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const fd = new FormData();
        fd.append("chunk", chunk);
        fd.append("uploadId", uploadId);
        fd.append("chunkIndex", String(i));
        fd.append("filename", file.name);
        const res = await fetch("/api/templates/chunk", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`Part ${i + 1}/${totalChunks} failed (HTTP ${res.status})`);
        const { chunkUrl } = await res.json();
        chunkUrls.push(chunkUrl);
      }

      const finalRes = await fetch("/api/templates/chunk/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkUrls, filename: file.name }),
      });
      if (!finalRes.ok) {
        const j = await finalRes.json().catch(() => ({}));
        throw new Error(j.error ?? "Error assembling file");
      }
      const { blobUrl } = await finalRes.json();

      const regRes = await fetch("/api/admin/firm-thesis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blobUrl, name: file.name }),
      });
      const data = await regRes.json().catch(() => ({}));
      if (!regRes.ok) throw new Error(data.error ?? "Error saving thesis");

      setThesis(data.thesis);
      setThesisFileName(data.fileName);
      setThesisMessage({ type: "success", text: "Investment thesis updated — used by the scan cron, document scanner, and Company 2-Pager" });
    } catch (e) {
      setThesisMessage({ type: "error", text: e instanceof Error ? e.message : "Upload failed" });
    }
    setThesisUploading(false);
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

        {/* Discovery Automation (admin only) */}
        {isAdmin && (
          <div className="bg-white border border-chalk rounded-[12px] p-6 mb-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[16px] font-semibold text-carbon">Discovery Automation</h2>
                <p className="text-[12px] text-slate mt-1 max-w-lg">
                  Pauses the daily cron that scans existing companies for news and discovers new
                  candidates. It still fires on schedule every weekday morning, it just does nothing
                  while paused, so you can turn it back on any time without re-configuring anything.
                </p>
              </div>
              <button
                onClick={handleCronToggle}
                disabled={cronLoading || cronSaving}
                aria-pressed={cronEnabled}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${
                  cronEnabled ? "bg-orange" : "bg-chalk"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    cronEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <p className="text-[12px] text-slate mt-3">
              {cronLoading ? "Loading…" : cronEnabled ? "Running daily, weekdays at 8am." : "Paused — the cron will skip its work until re-enabled."}
            </p>

            {cronMessage && (
              <div className={`rounded-[8px] p-3 text-[12px] border mt-3 ${
                cronMessage.type === "success"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {cronMessage.text}
              </div>
            )}
          </div>
        )}

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
                Pando's investment policy, used by the discovery cron, the "Scan document with AI" feature,
                and the Company 2-Pager to ground scoring and generated content in the fund's mandate.
                Upload a reference .docx to replace it, the text is extracted automatically and there is
                no word-by-word editing here.
              </p>
            </div>

            {thesisLoading ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex-1 px-3 py-2.5 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon truncate">
                    {thesisFileName ?? "No file uploaded — using PANDO default thesis"}
                  </div>
                  <label className="py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 cursor-pointer transition-colors disabled:opacity-40">
                    {thesisUploading ? "Uploading…" : thesisFileName ? "Replace" : "Upload"}
                    <input
                      type="file"
                      accept=".docx"
                      className="hidden"
                      disabled={thesisUploading}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleThesisUpload(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>

                <textarea
                  value={thesis}
                  readOnly
                  rows={14}
                  className="w-full px-3 py-2.5 text-[12px] leading-relaxed bg-fog border border-chalk rounded-[8px] text-slate placeholder:text-slate/60 focus:outline-none font-mono cursor-not-allowed"
                />
              </>
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

        {/* 2-Pager Template (admin only) */}
        {isAdmin && (
          <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-4 mb-8">
            <div>
              <h2 className="text-[16px] font-semibold text-carbon">2-Pager Template</h2>
              <p className="text-[12px] text-slate mt-1">
                Upload a reference .docx and every generated Company 2-Pager will match its exact
                fonts, colors, and page structure (margins, header, footer). Only the content is
                replaced with AI-generated text — the content of this file is never used as source
                material, only its visual styling.
              </p>
            </div>

            {templateLoading ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex-1 px-3 py-2.5 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon truncate">
                  {templateName ?? "No template uploaded — using PANDO default styling"}
                </div>
                <label className="py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 cursor-pointer transition-colors disabled:opacity-40">
                  {templateUploading ? "Uploading…" : templateName ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept=".docx"
                    disabled={templateUploading}
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleTemplateUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            )}

            {templateMessage && (
              <div className={`rounded-[8px] p-3 text-[12px] border ${
                templateMessage.type === "success"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {templateMessage.text}
              </div>
            )}
          </div>
        )}

        {/* IRL Default Structure (admin only) */}
        {isAdmin && (
          <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-4 mb-8">
            <div>
              <h2 className="text-[16px] font-semibold text-carbon">IRL Default Structure</h2>
              <p className="text-[12px] text-slate mt-1">
                Default section outline for the Internal Review Letter. Each user can still edit their own copy
                of this outline when building a specific document.
              </p>
            </div>

            {irlSectionsLoading ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
            ) : (
              <div className="space-y-3">
                {irlSections.map((s, idx) => (
                  <div key={s.id} className="border border-chalk rounded-[8px] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={s.title}
                        onChange={e => updateIrlSection(idx, { title: e.target.value })}
                        placeholder="Section title"
                        className="flex-1 px-3 py-2 text-[12px] font-medium bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-orange"
                      />
                      <button
                        onClick={() => moveIrlSection(idx, -1)}
                        disabled={idx === 0}
                        className="px-2 py-2 text-slate hover:text-carbon disabled:opacity-30 text-[12px]"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveIrlSection(idx, 1)}
                        disabled={idx === irlSections.length - 1}
                        className="px-2 py-2 text-slate hover:text-carbon disabled:opacity-30 text-[12px]"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeIrlSection(idx)}
                        className="px-2 py-2 text-red-500 hover:text-red-700 text-[12px]"
                        title="Remove section"
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      value={s.guidance}
                      onChange={e => updateIrlSection(idx, { guidance: e.target.value })}
                      placeholder="Guidance for what this section should cover"
                      rows={2}
                      className="w-full px-3 py-2 text-[11px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange"
                    />
                  </div>
                ))}

                <button
                  onClick={addIrlSection}
                  className="w-full py-2 border border-dashed border-chalk rounded-[8px] text-[12px] text-slate hover:text-carbon hover:border-graphite transition-colors"
                >
                  + Add Section
                </button>
              </div>
            )}

            {irlSectionsMessage && (
              <div className={`rounded-[8px] p-3 text-[12px] border ${
                irlSectionsMessage.type === "success"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {irlSectionsMessage.text}
              </div>
            )}

            <button
              onClick={handleIrlSectionsSave}
              disabled={irlSectionsSaving || irlSectionsLoading}
              className="py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {irlSectionsSaving ? "Saving…" : "Save Structure"}
            </button>
          </div>
        )}

        {/* IRL Due-Diligence Questionnaire (admin only) */}
        {isAdmin && (
          <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-4 mb-8">
            <div>
              <h2 className="text-[16px] font-semibold text-carbon">IRL Due-Diligence Questionnaire</h2>
              <p className="text-[12px] text-slate mt-1">
                Questions analysts answer before drafting an IRL. Answers are treated as authoritative
                and incorporated directly into the draft.
              </p>
            </div>

            {irlQuestionsLoading ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
            ) : (
              <div className="space-y-3">
                {irlQuestions.map((q, idx) => (
                  <div key={q.id} className="border border-chalk rounded-[8px] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={q.category}
                        onChange={e => updateIrlQuestion(idx, { category: e.target.value })}
                        placeholder="Category"
                        className="w-32 shrink-0 px-3 py-2 text-[12px] font-medium bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-orange"
                      />
                      <input
                        type="text"
                        value={q.question}
                        onChange={e => updateIrlQuestion(idx, { question: e.target.value })}
                        placeholder="Question"
                        className="flex-1 px-3 py-2 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-orange"
                      />
                      <button
                        onClick={() => moveIrlQuestion(idx, -1)}
                        disabled={idx === 0}
                        className="px-2 py-2 text-slate hover:text-carbon disabled:opacity-30 text-[12px]"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveIrlQuestion(idx, 1)}
                        disabled={idx === irlQuestions.length - 1}
                        className="px-2 py-2 text-slate hover:text-carbon disabled:opacity-30 text-[12px]"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeIrlQuestion(idx)}
                        className="px-2 py-2 text-red-500 hover:text-red-700 text-[12px]"
                        title="Remove question"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={addIrlQuestion}
                  className="w-full py-2 border border-dashed border-chalk rounded-[8px] text-[12px] text-slate hover:text-carbon hover:border-graphite transition-colors"
                >
                  + Add Question
                </button>
              </div>
            )}

            {irlQuestionsMessage && (
              <div className={`rounded-[8px] p-3 text-[12px] border ${
                irlQuestionsMessage.type === "success"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {irlQuestionsMessage.text}
              </div>
            )}

            <button
              onClick={handleIrlQuestionsSave}
              disabled={irlQuestionsSaving || irlQuestionsLoading}
              className="py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {irlQuestionsSaving ? "Saving…" : "Save Questionnaire"}
            </button>
          </div>
        )}

        {/* IRL Template (admin only) */}
        {isAdmin && (
          <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-4 mb-8">
            <div>
              <h2 className="text-[16px] font-semibold text-carbon">IRL Template</h2>
              <p className="text-[12px] text-slate mt-1">
                Upload a reference .docx and every generated Internal Review Letter will match its exact
                fonts, colors, and page structure (margins, header, footer). Only the content is
                replaced with AI-generated text — the content of this file is never used as source
                material, only its visual styling.
              </p>
            </div>

            {irlTemplateLoading ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading...</div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex-1 px-3 py-2.5 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon truncate">
                  {irlTemplateName ?? "No template uploaded — using PANDO default styling"}
                </div>
                <label className="py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 cursor-pointer transition-colors disabled:opacity-40">
                  {irlTemplateUploading ? "Uploading…" : irlTemplateName ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept=".docx"
                    disabled={irlTemplateUploading}
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleIrlTemplateUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            )}

            {irlTemplateMessage && (
              <div className={`rounded-[8px] p-3 text-[12px] border ${
                irlTemplateMessage.type === "success"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {irlTemplateMessage.text}
              </div>
            )}
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
