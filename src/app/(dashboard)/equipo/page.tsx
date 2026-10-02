"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AVAILABILITY_LEVELS, STALE_AFTER_DAYS, levelInfo } from "@/lib/availability";

type Update = {
  id: string; userId: string; level: string; comment: string | null; currentWork: string | null;
  availableFrom: string | null; interests: string | null; createdBy: string | null; createdAt: string | null;
};
type Member = {
  id: string; name: string; email: string; role: string; avatarUrl: string | null;
  current: Update | null;
};

const EMPTY_FORM = { level: "", comment: "", currentWork: "", availableFrom: "", interests: "" };

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}

function fmtRelative(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDate(ymd: string | null): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initialsOf(name: string) {
  return name.trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

function LevelPill({ level }: { level: string | null | undefined }) {
  const info = levelInfo(level);
  if (!info) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium border border-dashed border-chalk text-slate rounded-[20px] px-2 py-0.5 whitespace-nowrap">
        Not set
      </span>
    );
  }
  return (
    <span
      style={{ background: info.bg, borderColor: info.border, color: info.text }}
      className="inline-flex items-center gap-1.5 text-[10px] font-medium border rounded-[20px] px-2 py-0.5 whitespace-nowrap"
    >
      <span style={{ background: info.dot }} className="w-1.5 h-1.5 rounded-full inline-block" />
      {info.label}
    </span>
  );
}

export default function EquipoPage() {
  const { data: session } = useSession();
  const myId    = session?.user?.id;
  const isAdmin = session?.user?.role === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<string>("all");

  // Whose availability the form is editing (self by default; admins can pick anyone)
  const [targetId, setTargetId] = useState<string | null>(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState<string | null>(null);

  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory]       = useState<Update[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/team/availability", { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error();
      setMembers(await res.json());
    } catch {
      setError("Couldn't load team availability.");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const editingId = targetId ?? myId ?? null;
  const editing   = members.find(m => m.id === editingId) ?? null;
  const editingSelf = editingId === myId;

  // Prefill the form with the current status of whoever is being edited
  useEffect(() => {
    const c = editing?.current;
    setForm(c ? {
      level: c.level, comment: c.comment ?? "", currentWork: c.currentWork ?? "",
      availableFrom: c.availableFrom ?? "", interests: c.interests ?? "",
    } : EMPTY_FORM);
    setSaveMsg(null);
  }, [editing?.id, editing?.current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.level) { setSaveMsg("Pick an availability level."); return; }
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/team/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, userId: editingId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSaveMsg("Saved");
      if (historyFor === editingId) openHistory(editingId!, true);
      await load();
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(userId: string, force = false) {
    if (historyFor === userId && !force) { setHistoryFor(null); return; }
    setHistoryFor(userId);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/team/availability?userId=${encodeURIComponent(userId)}`);
      setHistory(res.ok ? await res.json() : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function editMember(id: string) {
    setTargetId(id === myId ? null : id);
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Summary counts
  const counts: Record<string, number> = { unset: 0 };
  for (const l of AVAILABILITY_LEVELS) counts[l.value] = 0;
  for (const m of members) counts[m.current?.level ?? "unset"] = (counts[m.current?.level ?? "unset"] ?? 0) + 1;

  const visible = members.filter(m =>
    filter === "all" ? true : filter === "unset" ? !m.current : m.current?.level === filter,
  );

  const subtitle = loading ? "Loading…"
    : `${counts.available} available · ${counts.partial} partial · ${counts.nearly_full + counts.full} busy`;

  const inputClass = "w-full px-3 py-2 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-carbon";
  const dateLabel  = form.level === "away" ? "Back on" : "Available from";

  return (
    <div>
      <Topbar title="Team" subtitle={subtitle} />

      <div className="p-6 space-y-4">
        {/* ── Update form ─────────────────────────────────────────────── */}
        <Card className={editingSelf ? "" : "border-2 border-carbon"}>
          <SectionHeader
            title={editingSelf ? "My availability" : `Availability · ${editing?.name ?? ""}`}
            subtitle={
              editing?.current
                ? `Last updated ${fmtRelative(editing.current.createdAt)}`
                : "Not set yet: let the team know how much room you have"
            }
            action={!editingSelf && (
              <Button variant="ghost" size="sm" onClick={() => setTargetId(null)}>Back to mine</Button>
            )}
          />
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {AVAILABILITY_LEVELS.map(l => {
                const selected = form.level === l.value;
                return (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setForm({ ...form, level: l.value })}
                    style={selected ? { background: l.bg, borderColor: l.dot } : undefined}
                    className={`text-left px-3 py-2.5 rounded-[8px] border-2 transition-colors ${selected ? "" : "bg-fog border-transparent hover:border-chalk"}`}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-carbon">
                      <span style={{ background: l.dot }} className="w-2.5 h-2.5 rounded-full inline-block" />
                      {l.label}
                    </span>
                    <span className="block text-[11px] text-slate mt-0.5">{l.hint}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] text-slate mb-1 font-medium">Currently working on</label>
                <input value={form.currentWork} onChange={e => setForm({ ...form, currentWork: e.target.value })}
                  className={inputClass} placeholder="E.g. Project Atlas due diligence" maxLength={300} />
              </div>
              <div>
                <label className="block text-[11px] text-slate mb-1 font-medium">{dateLabel}</label>
                <input type="date" value={form.availableFrom} onChange={e => setForm({ ...form, availableFrom: e.target.value })}
                  className={inputClass} />
              </div>
              <div>
                <label className="block text-[11px] text-slate mb-1 font-medium">Interested in</label>
                <input value={form.interests} onChange={e => setForm({ ...form, interests: e.target.value })}
                  className={inputClass} placeholder="E.g. Fintech, sell-side, modelling" maxLength={300} />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate mb-1 font-medium">Comments</label>
              <textarea value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })}
                className={`${inputClass} min-h-[64px] resize-y`} maxLength={1000}
                placeholder="Anything the team should know: constraints, preferred hours, upcoming time off…" />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" variant="fill" size="sm" loading={saving} disabled={!editing}>Save availability</Button>
              {saveMsg && (
                <span className={`text-[12px] ${saveMsg === "Saved" ? "text-emerald-700" : "text-red-600"}`}>{saveMsg}</span>
              )}
            </div>
          </form>
        </Card>

        {/* ── Summary / filters ───────────────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: "all", label: "Everyone", count: members.length, dot: null as string | null },
            ...AVAILABILITY_LEVELS.map(l => ({ value: l.value as string, label: l.label, count: counts[l.value], dot: l.dot as string | null })),
            { value: "unset", label: "Not set", count: counts.unset, dot: null },
          ].map(f => (
            <button key={f.value} type="button" onClick={() => setFilter(f.value)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-[20px] border font-medium transition-colors ${filter === f.value ? "bg-carbon text-white border-carbon" : "bg-paper text-graphite border-chalk hover:border-carbon"}`}>
              {f.dot && <span style={{ background: f.dot }} className="w-1.5 h-1.5 rounded-full inline-block" />}
              {f.label} <span className="opacity-60">{f.count}</span>
            </button>
          ))}
        </div>

        {/* ── Team grid ───────────────────────────────────────────────── */}
        {error && <Card><p className="text-[13px] text-red-600">{error}</p></Card>}
        {loading ? (
          <Card><p className="text-[13px] text-slate">Loading team…</p></Card>
        ) : visible.length === 0 && !error ? (
          <Card><p className="text-[13px] text-slate">Nobody matches this filter.</p></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map(m => {
              const c     = m.current;
              const age   = daysSince(c?.createdAt ?? null);
              const stale = age != null && age >= STALE_AFTER_DAYS;
              const isMe  = m.id === myId;
              return (
                <Card key={m.id} padding="sm" className="flex flex-col">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-forest text-white flex items-center justify-center text-[12px] font-semibold shrink-0">
                      {initialsOf(m.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-carbon truncate">{m.name}{isMe && <span className="text-slate font-normal"> (you)</span>}</p>
                      </div>
                      <p className="text-[11px] text-slate capitalize">{m.role}</p>
                    </div>
                    <LevelPill level={c?.level} />
                  </div>

                  {c && (
                    <div className="mt-3 space-y-1.5 text-[12px]">
                      {c.currentWork && (
                        <p className="text-carbon"><span className="text-slate">Working on: </span>{c.currentWork}</p>
                      )}
                      {c.availableFrom && (
                        <p className="text-carbon"><span className="text-slate">{c.level === "away" ? "Back on" : "Available from"}: </span>{fmtDate(c.availableFrom)}</p>
                      )}
                      {c.interests && (
                        <p className="text-carbon"><span className="text-slate">Interested in: </span>{c.interests}</p>
                      )}
                      {c.comment && (
                        <p className="text-graphite bg-fog rounded-[6px] px-2.5 py-1.5 whitespace-pre-wrap">{c.comment}</p>
                      )}
                    </div>
                  )}

                  <div className="mt-auto pt-3 flex items-center justify-between gap-2">
                    <span className={`text-[10px] ${stale ? "text-amber-700 font-medium" : "text-slate"}`}>
                      {c ? `${stale ? "⚠ Outdated · " : ""}Updated ${fmtRelative(c.createdAt)}` : "No availability shared yet"}
                    </span>
                    <div className="flex items-center gap-1">
                      {c && (
                        <button type="button" onClick={() => openHistory(m.id)}
                          className="text-[11px] text-slate hover:text-carbon px-1.5 py-0.5 rounded hover:bg-fog transition-colors">
                          {historyFor === m.id ? "Hide history" : "History"}
                        </button>
                      )}
                      {(isMe || isAdmin) && (
                        <button type="button" onClick={() => editMember(m.id)}
                          className="text-[11px] text-slate hover:text-carbon px-1.5 py-0.5 rounded hover:bg-fog transition-colors">
                          Update
                        </button>
                      )}
                    </div>
                  </div>

                  {historyFor === m.id && (
                    <div className="mt-3 border-t border-chalk pt-3">
                      {historyLoading ? (
                        <p className="text-[11px] text-slate">Loading…</p>
                      ) : (
                        <ul className="space-y-2">
                          {history.map(h => (
                            <li key={h.id} className="text-[11px]">
                              <div className="flex items-center justify-between gap-2">
                                <LevelPill level={h.level} />
                                <span className="text-slate">{fmtRelative(h.createdAt)}</span>
                              </div>
                              {(h.currentWork || h.comment) && (
                                <p className="text-graphite mt-1 line-clamp-2">{[h.currentWork, h.comment].filter(Boolean).join(" · ")}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
