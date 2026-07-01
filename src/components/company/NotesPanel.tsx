"use client";
import { useState, useEffect, useCallback } from "react";

type Note = {
  id: string;
  companyId: string;
  content: string;
  authorName: string;
  createdAt: string;
};

export function NotesPanel({ companyId, authorName }: { companyId: string; authorName?: string }) {
  const [notes,   setNotes]   = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [text,    setText]    = useState("");
  const [saving,  setSaving]  = useState(false);
  const [deleting,setDeleting]= useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/notes?companyId=${companyId}`);
    setNotes(await res.json());
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, content: text, authorName }),
    });
    setText("");
    setSaving(false);
    load();
  }

  async function del(id: string) {
    setDeleting(id);
    await fetch("/api/notes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setNotes(prev => prev.filter(n => n.id !== id));
    setDeleting(null);
  }

  function fmtDate(s: string) {
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(s));
  }

  return (
    <div className="space-y-3">
      {/* Input */}
      <form onSubmit={submit} className="space-y-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Write a note... (founder call, partner info, sector updates...)"
          rows={3}
          className="w-full px-3 py-2 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-carbon resize-none leading-relaxed"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!text.trim() || saving}
            className="px-4 py-1.5 text-[12px] font-medium bg-carbon text-white rounded-btn hover:opacity-85 disabled:opacity-40 transition-opacity"
          >
            {saving ? "Saving..." : "Add note"}
          </button>
        </div>
      </form>

      {/* Notes list */}
      {loading ? (
        <p className="text-[12px] text-slate py-2">Loading notes...</p>
      ) : notes.length === 0 ? (
        <p className="text-[12px] text-slate py-4 text-center border border-dashed border-chalk rounded-[8px]">
          No notes yet — be the first to add context
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} className="group bg-fog rounded-[8px] p-3 border border-chalk hover:border-carbon/20 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-none">
                  <div className="w-6 h-6 rounded-full bg-carbon flex items-center justify-center text-white text-[9px] font-bold">
                    {note.authorName.split(" ").map(w => w[0]).slice(0,2).join("")}
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-carbon">{note.authorName}</span>
                    <span className="text-[10px] text-slate ml-2">{fmtDate(note.createdAt)}</span>
                  </div>
                </div>
                <button
                  onClick={() => del(note.id)}
                  disabled={deleting === note.id}
                  className="opacity-0 group-hover:opacity-100 text-slate hover:text-red-500 transition-all text-[10px] flex-none"
                  title="Delete note"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
              <p className="text-[13px] text-graphite mt-2 leading-relaxed whitespace-pre-wrap">{note.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
