"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { Languages, FileText, LayoutTemplate, Table2, File, Paperclip, Lock } from "lucide-react";

const TYPE_COLOR: Record<string, string> = {
  pptx: "bg-orange/10 text-orange border-orange/30",
  docx: "bg-blue-500/10 text-blue-600 border-blue-400/30",
  xlsx: "bg-green-500/10 text-green-700 border-green-400/30",
};
const TYPE_LABEL: Record<string, string> = { pptx: "PowerPoint", docx: "Word", xlsx: "Excel" };

function FileTypeIcon({ name, size = 20 }: { name: string; size?: number }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx") return <FileText size={size} className="text-blue-600" />;
  if (ext === "pptx") return <LayoutTemplate size={size} className="text-orange" />;
  if (ext === "xlsx") return <Table2 size={size} className="text-green-600" />;
  return <File size={size} className="text-graphite" />;
}

function fmtSize(b: number): string {
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

type Direction = "es-en" | "en-es";

// Files above this size go through chunked upload to Blob storage instead of
// a single POST body, since Vercel serverless functions cap request bodies
// at ~4.5 MB. This is what lets large legal/finance documents work at all.
const CHUNK_SIZE = 3 * 1024 * 1024; // 3 MB — safely under the 4.5 MB limit

type Phase = "idle" | "uploading" | "translating" | "finalizing";

export default function TranslatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [direction, setDirection] = useState<Direction>("es-en");
  const [hasApiKey, setHasApiKey] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const translating = phase !== "idle";

  const checkApiKey = useCallback(async () => {
    const r = await fetch("/api/user/api-key");
    if (r.ok) { const d = await r.json(); setHasApiKey(d.hasApiKey); }
  }, []);
  useEffect(() => { checkApiKey(); }, [checkApiKey]);

  function pickFile(f: File | null) {
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["docx", "pptx", "xlsx"].includes(ext)) {
      setError("Unsupported file type. Upload a .docx, .pptx, or .xlsx file.");
      return;
    }
    setFile(f);
    setError(null);
    setSuccess(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files[0] ?? null);
  }

  // Upload the file in 3 MB chunks to Vercel Blob and assemble it server-side —
  // works for files of any size, unlike a single multipart POST.
  async function uploadToBlob(f: File): Promise<string> {
    const uploadId = crypto.randomUUID();
    const totalChunks = Math.ceil(f.size / CHUNK_SIZE) || 1;
    const chunkUrls: string[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunk = f.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const fd = new FormData();
      fd.append("chunk", chunk);
      fd.append("uploadId", uploadId);
      fd.append("chunkIndex", String(i));
      fd.append("filename", f.name);

      const res = await fetch("/api/documents/translate/upload-chunk", { method: "POST", body: fd });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = `Upload part ${i + 1}/${totalChunks} failed (HTTP ${res.status})`;
        try { msg = JSON.parse(text).error ?? msg; } catch { if (text) msg += `: ${text.slice(0, 300)}`; }
        throw new Error(msg);
      }
      const { chunkUrl } = await res.json();
      chunkUrls.push(chunkUrl);
      setProgress({ done: i + 1, total: totalChunks });
    }

    const finalRes = await fetch("/api/documents/translate/upload-finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunkUrls, filename: f.name }),
    });
    if (!finalRes.ok) {
      const j = await finalRes.json().catch(() => ({}));
      throw new Error((j as any).error ?? "Error assembling uploaded file");
    }
    const { blobUrl } = await finalRes.json();
    return blobUrl;
  }

  async function handleTranslate() {
    if (!file) return;
    if (!hasApiKey) {
      setError("You need to configure your Anthropic API key in Settings to use translation.");
      return;
    }

    setError(null);
    setSuccess(false);

    try {
      // 1. Upload
      setPhase("uploading");
      setProgress({ done: 0, total: 1 });
      const blobUrl = await uploadToBlob(file);

      // 2. Start job — extracts every translatable segment
      setPhase("translating");
      setProgress({ done: 0, total: 0 });
      const startRes = await fetch("/api/documents/translate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl, filename: file.name, direction }),
      });
      const startJson = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(startJson.message ?? startJson.error ?? "Could not start translation");
      const { jobId, jobUrl, total } = startJson as { jobId: string; jobUrl: string; total: number };
      setProgress({ done: 0, total });

      // 3. Poll batch translation until done — each call is short, so
      //    documents of any size just take more (fast) round-trips.
      let done = total === 0;
      while (!done) {
        const batchRes = await fetch("/api/documents/translate/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, jobUrl }),
        });
        const batchJson = await batchRes.json().catch(() => ({}));
        if (!batchRes.ok) throw new Error(batchJson.message ?? batchJson.error ?? "Translation batch failed");
        setProgress({ done: batchJson.translatedCount ?? 0, total: batchJson.total ?? total });
        done = !!batchJson.done;
      }

      // 4. Finalize — reassemble and download. The job blob can briefly lag
      //    behind the last batch write (CDN propagation), so finalize itself
      //    retries server-side — but retry here too in case that's still not
      //    enough, rather than surfacing a transient "not finished yet" as a
      //    hard failure to the user.
      setPhase("finalizing");
      const attemptFinalize = () => fetch("/api/documents/translate/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, jobUrl }),
      });
      let finalizeRes = await attemptFinalize();
      for (let attempt = 0; finalizeRes.status === 409 && attempt < 2; attempt++) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        finalizeRes = await attemptFinalize();
      }
      if (!finalizeRes.ok) {
        const j = await finalizeRes.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? "Could not finalize the translated document");
      }
      const blob = await finalizeRes.blob();
      const disposition = finalizeRes.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? decodeURIComponent(match[1]) : `translated.${file.name.split(".").pop()}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 6000);
    } catch (err: any) {
      setError(err?.message ?? "Error during translation");
    }

    setPhase("idle");
  }

  const phaseLabel =
    phase === "uploading" ? `Uploading document… (${progress.done}/${progress.total})`
    : phase === "translating" ? (progress.total > 0 ? `Translating with AI… (${progress.done}/${progress.total} segments)` : "Reading document…")
    : phase === "finalizing" ? "Rebuilding document…"
    : "";
  const progressPct = phase === "translating" && progress.total > 0 ? Math.round((progress.done / progress.total) * 100)
    : phase === "uploading" && progress.total > 0 ? Math.round((progress.done / progress.total) * 100)
    : phase === "finalizing" ? 100 : 5;

  return (
    <div className="flex-1 overflow-y-auto bg-mist">
      <div className="max-w-2xl mx-auto py-10 px-6 space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-[12px] bg-orange/10 flex items-center justify-center shrink-0">
            <Languages size={22} className="text-orange" />
          </div>
          <div>
            <h1 className="text-[20px] font-semibold text-carbon">Document Translator</h1>
            <p className="text-[12px] text-slate mt-0.5">Spanish ⇄ English, formatting preserved</p>
          </div>
        </div>

        {/* Step 1 — Upload */}
        <div className="bg-white border border-chalk rounded-[12px] p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-5 h-5 rounded-full bg-orange text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
            <div className="text-[13px] font-semibold text-carbon">Upload document</div>
          </div>

          <input ref={fileRef} type="file" accept=".docx,.pptx,.xlsx" className="hidden"
            onChange={e => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />

          {file ? (
            <div className="flex items-center gap-3 p-3 bg-fog rounded-[8px] border border-chalk">
              <span className="shrink-0"><FileTypeIcon name={file.name} /></span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-carbon truncate">{file.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${TYPE_COLOR[file.name.split(".").pop()!.toLowerCase()]}`}>
                    {TYPE_LABEL[file.name.split(".").pop()!.toLowerCase()]}
                  </span>
                  <span className="text-[10px] text-slate">{fmtSize(file.size)}</span>
                </div>
              </div>
              <button onClick={() => setFile(null)} className="text-slate hover:text-carbon p-1 rounded hover:bg-chalk transition-colors">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ) : (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`rounded-[8px] border-2 border-dashed py-8 text-center cursor-pointer transition-colors ${
                dragOver ? "border-carbon bg-fog" : "border-chalk hover:border-graphite/40 hover:bg-fog/50"}`}>
              <div className="flex justify-center mb-2"><Paperclip size={26} className="text-chalk" /></div>
              <div className="text-[12px] font-medium text-carbon">Click or drop a file here</div>
              <div className="text-[10px] mt-1 text-slate">Word · PowerPoint · Excel — any size, including long legal documents</div>
            </div>
          )}
        </div>

        {/* Step 2 — Direction */}
        <div className="bg-white border border-chalk rounded-[12px] p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-5 h-5 rounded-full bg-orange text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
            <div className="text-[13px] font-semibold text-carbon">Translation direction</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setDirection("es-en")}
              className={`flex items-center justify-center gap-2 py-3 rounded-[9px] border text-[13px] font-medium transition-colors ${
                direction === "es-en" ? "bg-carbon text-white border-carbon" : "border-chalk text-graphite hover:bg-fog"}`}>
              Spanish → English
            </button>
            <button onClick={() => setDirection("en-es")}
              className={`flex items-center justify-center gap-2 py-3 rounded-[9px] border text-[13px] font-medium transition-colors ${
                direction === "en-es" ? "bg-carbon text-white border-carbon" : "border-chalk text-graphite hover:bg-fog"}`}>
              English → Spanish
            </button>
          </div>
        </div>

        {/* API key warning */}
        {!hasApiKey && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-[10px] p-4">
            <div className="text-[12px] font-medium text-yellow-800 mb-1">⚠ API key required</div>
            <div className="text-[11px] text-yellow-700 mb-2">Configure your Anthropic API key to translate documents.</div>
            <a href="/settings" className="text-[11px] font-semibold text-yellow-700 underline hover:text-yellow-900">Go to Settings →</a>
          </div>
        )}

        {/* Step 3 — Translate */}
        <div className="bg-white border border-chalk rounded-[12px] p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-5 h-5 rounded-full bg-orange text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
            <div className="text-[13px] font-semibold text-carbon">Translate document</div>
          </div>

          {error && <div className="mb-4 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] p-3">{error}</div>}
          {success && (
            <div className="mb-4 text-[12px] text-green-700 bg-green-50 border border-green-200 rounded-[8px] p-3 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" fill="#22c55e"/>
                <polyline points="4,7 6,9 10,5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Translated document downloaded!
            </div>
          )}

          {translating && (
            <div className="mb-4 rounded-[10px] border border-chalk bg-fog p-4">
              <div className="flex items-center gap-2 mb-3">
                <svg className="animate-spin w-4 h-4 text-carbon shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                </svg>
                <span className="text-[13px] font-semibold text-carbon">{phaseLabel}</span>
              </div>
              <div className="h-1.5 rounded-full bg-chalk overflow-hidden">
                <div className="h-full bg-carbon transition-all duration-500 rounded-full" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-[10px] text-slate mt-2">
                Large documents are processed in small batches, so translation scales to documents of any size — this may take a while for long legal or financial documents.
              </p>
            </div>
          )}

          <button onClick={handleTranslate} disabled={translating || !file}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-orange text-white rounded-[10px] text-[14px] font-semibold hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {translating ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                </svg>
                {phase === "uploading" ? "Uploading…" : phase === "finalizing" ? "Finalizing…" : "Translating…"}
              </>
            ) : (
              <>
                <Languages size={15} />
                Translate and Download
              </>
            )}
          </button>

          <div className="mt-4 pt-4 border-t border-chalk flex items-start gap-2">
            <Lock size={14} className="text-slate shrink-0" />
            <div className="text-[10px] text-slate leading-relaxed">
              Your document is translated in place — layout, styling, images, and structure are preserved. Nothing is stored on the server.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
