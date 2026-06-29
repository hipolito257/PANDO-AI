"use client";
import { useState, useEffect, useRef, useCallback } from "react";

interface DocTemplate {
  id: string; name: string; type: "pptx" | "docx" | "xlsx";
  description: string | null; fileSize: number | null;
  placeholders: string[]; createdAt: string | null;
}
interface Company { id: string; name: string; sector: string | null; stage: string | null; }
interface GenResult {
  replacements: { find: string; replace: string }[];
  file: string; // base64
  filename: string;
  previewText: string;
  ext: string;
  _debug?: {
    hadCompany: boolean; hadContextFiles: number;
    hadUserPrompt: boolean; hadApiKey: boolean; templateTextLength: number;
  };
}

const TYPE_COLOR: Record<string, string> = {
  pptx: "bg-orange/10 text-orange border-orange/30",
  docx: "bg-blue-500/10 text-blue-600 border-blue-400/30",
  xlsx: "bg-green-500/10 text-green-700 border-green-400/30",
};
const TYPE_ICON: Record<string, string>  = { pptx: "📊", docx: "📝", xlsx: "📋" };
const TYPE_LABEL: Record<string, string> = { pptx: "PowerPoint", docx: "Word", xlsx: "Excel" };

function fmtSize(b: number | null): string {
  if (!b) return "";
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return { pdf: "📕", docx: "📝", pptx: "📊", xlsx: "📋", txt: "📃", csv: "📋",
           png: "🖼", jpg: "🖼", jpeg: "🖼" }[ext] ?? "📄";
}

export default function DocumentosPage() {
  const [templates, setTemplates]     = useState<DocTemplate[]>([]);
  const [companies, setCompanies]     = useState<Company[]>([]);
  const [selected, setSelected]       = useState<DocTemplate | null>(null);
  const [companyId, setCompanyId]     = useState("");
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [userPrompt, setUserPrompt]    = useState("");
  const [hasApiKey, setHasApiKey]     = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [genStep, setGenStep]         = useState(0);
  const [uploadErr, setUploadErr]     = useState<string | null>(null);
  const [genErr, setGenErr]           = useState<string | null>(null);
  const [genSuccess, setGenSuccess]   = useState(false);
  const [genResult, setGenResult]     = useState<GenResult | null>(null);
  const [building, setBuilding]       = useState(false);
  const [buildErr, setBuildErr]       = useState<string | null>(null);
  const [showUpload, setShowUpload]   = useState(false);
  const [dragOver, setDragOver]       = useState(false);
  const [ctxDragOver, setCtxDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadName, setUploadName]   = useState("");
  const [uploadDesc, setUploadDesc]   = useState("");
  const templateFileRef = useRef<HTMLInputElement>(null);
  const contextFileRef  = useRef<HTMLInputElement>(null);

  const loadTemplates = useCallback(async () => {
    const r = await fetch("/api/templates");
    if (r.ok) setTemplates(await r.json());
  }, []);
  const loadCompanies = useCallback(async () => {
    const r = await fetch("/api/companies");
    if (r.ok) { const d = await r.json(); setCompanies(d.companies ?? d); }
  }, []);
  const checkApiKey = useCallback(async () => {
    const r = await fetch("/api/user/api-key");
    if (r.ok) { const d = await r.json(); setHasApiKey(d.hasApiKey); }
  }, []);

  useEffect(() => { loadTemplates(); loadCompanies(); checkApiKey(); }, [loadTemplates, loadCompanies, checkApiKey]);

  const GEN_STEPS = [
    "Descargando plantilla…",
    "Analizando estructura del documento…",
    "Cargando datos de la empresa…",
    "Procesando con IA…",
    "Aplicando cambios al documento…",
  ];

  // Advance progress steps on a schedule while generating
  useEffect(() => {
    if (!generating) { setGenStep(0); return; }
    const delays = [0, 3000, 7000, 13000, 28000];
    const timers = delays.map((d, i) => setTimeout(() => setGenStep(i), d));
    return () => timers.forEach(clearTimeout);
  }, [generating]);

  // ── Upload template ────────────────────────────────────────────────────────
  // Files up to 25 MB: chunked upload (3 MB per chunk) → Vercel Blob assembly
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const CHUNK_SIZE        =  3 * 1024 * 1024; // 3 MB — well under Vercel's 4.5 MB limit

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingFile || !uploadName.trim()) return;
    if (pendingFile.size > MAX_UPLOAD_BYTES) {
      setUploadErr(`El archivo es demasiado grande (${fmtSize(pendingFile.size)}). El límite es 25 MB.`);
      return;
    }

    setUploading(true); setUploadErr(null);
    const ext      = pendingFile.name.split(".").pop()?.toLowerCase() ?? "";
    const uploadId = crypto.randomUUID();

    try {
      const totalChunks = Math.ceil(pendingFile.size / CHUNK_SIZE);
      const chunkUrls: string[] = [];

      // Upload each chunk sequentially
      for (let i = 0; i < totalChunks; i++) {
        const chunk = pendingFile.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const fd = new FormData();
        fd.append("chunk",       chunk);
        fd.append("uploadId",    uploadId);
        fd.append("chunkIndex",  String(i));
        fd.append("filename",    pendingFile.name);

        const res = await fetch("/api/templates/chunk", { method: "POST", body: fd });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          let msg = `Parte ${i + 1}/${totalChunks} falló (HTTP ${res.status})`;
          try { msg = JSON.parse(text).error ?? msg; } catch { if (text) msg += `: ${text.slice(0, 300)}`; }
          throw new Error(msg);
        }
        const { chunkUrl } = await res.json();
        chunkUrls.push(chunkUrl);
      }

      // Finalize: assemble chunks into one file in Vercel Blob
      const finalRes = await fetch("/api/templates/chunk/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkUrls, filename: pendingFile.name }),
      });
      if (!finalRes.ok) {
        const j = await finalRes.json().catch(() => ({}));
        throw new Error((j as any).error ?? "Error ensamblando archivo");
      }
      const { blobUrl } = await finalRes.json();

      // Register template in database
      const regRes = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl,
          name: uploadName.trim(),
          description: uploadDesc.trim() || undefined,
          type: ext,
        }),
      });
      if (!regRes.ok) {
        const j = await regRes.json().catch(() => ({}));
        throw new Error((j as any).error ?? "Error registrando plantilla");
      }

      const t = await regRes.json() as DocTemplate;
      setTemplates(prev => [t, ...prev]);
      setShowUpload(false); setPendingFile(null); setUploadName(""); setUploadDesc("");
      setSelected(t);

    } catch (err: any) {
      setUploadErr(err?.message ?? "Error al subir archivo");
    }

    setUploading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta plantilla?")) return;
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    setTemplates(prev => prev.filter(t => t.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  // ── Generate document ──────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!selected) return;

    if ((contextFiles.length > 0 || userPrompt.trim() || companyId) && !hasApiKey) {
      setGenErr("Necesitas configurar tu API key de Anthropic en Configuración para usar esta función");
      return;
    }

    setGenerating(true); setGenErr(null); setGenSuccess(false); setGenResult(null);

    const fd = new FormData();
    fd.append("templateId", selected.id);
    if (companyId) fd.append("companyId", companyId);
    if (userPrompt.trim()) fd.append("userPrompt", userPrompt.trim());
    for (const f of contextFiles) fd.append("files", f);

    try {
      const res = await fetch("/api/documents/generate", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({})) as any;
      if (!res.ok) {
        if (j.code === "NO_API_KEY") {
          setGenErr("⚠️ " + j.error + " → Ve a Configuración para agregarla");
        } else {
          setGenErr(j.error ?? "Error al generar");
        }
      } else {
        setGenResult(j as GenResult);
      }
    } catch (err: any) {
      setGenErr(err?.message ?? "Error de red al generar");
    }

    setGenerating(false);
  }

  function downloadResult(result: GenResult) {
    const mimeMap: Record<string, string> = {
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const bytes = Uint8Array.from(atob(result.file), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mimeMap[result.ext] ?? "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = result.filename; a.click();
    URL.revokeObjectURL(url);
    setGenResult(null);
    setGenSuccess(true);
    setTimeout(() => setGenSuccess(false), 5000);
  }

  // ── Build native PPTX (advanced mode with charts) ─────────────────────────
  async function handleBuild() {
    if (!selected || selected.type !== "pptx") return;
    setBuilding(true); setBuildErr(null);
    const fd = new FormData();
    fd.append("templateId", selected.id);
    if (companyId) fd.append("companyId", companyId);
    if (userPrompt.trim()) fd.append("userPrompt", userPrompt.trim());
    for (const f of contextFiles) fd.append("files", f);
    try {
      const res = await fetch("/api/documents/build", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({})) as { success?: boolean; data?: string; filename?: string; slide_count?: number; error?: string };
      if (!res.ok || !j.success) {
        setBuildErr(j.error ?? "Error al construir presentación");
      } else {
        // Download the PPTX
        const mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        const bytes = Uint8Array.from(atob(j.data!), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = j.filename!; a.click();
        URL.revokeObjectURL(url);
        setGenSuccess(true);
        setTimeout(() => setGenSuccess(false), 5000);
      }
    } catch (err: unknown) {
      setBuildErr((err as Error)?.message ?? "Error de red");
    }
    setBuilding(false);
  }

  // ── Context file drag & drop ───────────────────────────────────────────────
  function addContextFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    setContextFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...arr.filter(f => !existing.has(f.name + f.size))];
    });
  }
  function removeContextFile(idx: number) {
    setContextFiles(prev => prev.filter((_, i) => i !== idx));
  }

  function handleTemplateDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { setPendingFile(f); setUploadName(f.name.replace(/\.[^.]+$/, "")); setShowUpload(true); }
  }

  return (
    <div className="flex h-full">

      {/* ── Sidebar: template gallery ──────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-r border-chalk bg-paper flex flex-col h-full">
        <div className="px-5 py-4 border-b border-chalk flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-carbon">Documentos</h2>
            <p className="text-[11px] text-slate mt-0.5">Plantillas guardadas</p>
          </div>
          <button onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-carbon text-white text-[12px] font-medium rounded-[7px] hover:bg-graphite transition-colors">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <line x1="5.5" y1="1" x2="5.5" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="1" y1="5.5" x2="10" y2="5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Subir
          </button>
        </div>

        <div onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)} onDrop={handleTemplateDrop}
          className={`mx-3 mt-3 mb-1 rounded-[8px] border-2 border-dashed text-center py-3 text-[11px] transition-colors ${
            dragOver ? "border-carbon bg-fog text-carbon" : "border-chalk/60 text-slate/60"}`}>
          Arrastra plantilla aquí
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {templates.length === 0 && (
            <div className="text-center py-12 text-slate text-[12px]"><div className="text-3xl mb-2">📄</div>Sube tu primera plantilla</div>
          )}
          {templates.map(t => (
            <button key={t.id} onClick={() => { setSelected(t); setGenSuccess(false); setGenErr(null); setContextFiles([]); }}
              className={`w-full text-left rounded-[8px] p-3 border transition-all group ${
                selected?.id === t.id ? "bg-carbon text-white border-carbon" : "bg-white border-chalk hover:border-graphite/30 hover:shadow-sm"}`}>
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none mt-0.5">{TYPE_ICON[t.type]}</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] font-semibold truncate ${selected?.id === t.id ? "text-white" : "text-carbon"}`}>{t.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                      selected?.id === t.id ? "bg-white/20 text-white border-white/30" : TYPE_COLOR[t.type]}`}>
                      {TYPE_LABEL[t.type]}
                    </span>
                    {t.fileSize && <span className={`text-[10px] ${selected?.id === t.id ? "text-white/60" : "text-slate"}`}>{fmtSize(t.fileSize)}</span>}
                  </div>
                  {t.description && <div className={`text-[10px] mt-1 truncate ${selected?.id === t.id ? "text-white/70" : "text-slate"}`}>{t.description}</div>}
                </div>
                <button onClick={e => { e.stopPropagation(); handleDelete(t.id); }}
                  className={`opacity-0 group-hover:opacity-100 p-1 rounded ${selected?.id === t.id ? "hover:bg-white/20 text-white/60" : "hover:bg-fog text-slate"}`}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-mist">

        {/* Upload modal */}
        {showUpload && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-[14px] shadow-xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-[15px] font-semibold text-carbon">Subir Plantilla</h3>
                  <p className="text-[11px] text-slate mt-0.5">Sube tu documento sin modificarlo</p>
                </div>
                <button onClick={() => { setShowUpload(false); setPendingFile(null); setUploadErr(null); }} className="text-slate hover:text-carbon">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
              <form onSubmit={handleUpload} className="space-y-4">
                <div>
                  {pendingFile ? (
                    <div className="flex items-center gap-3 p-3 bg-fog rounded-[8px] border border-chalk">
                      <span className="text-xl">{fileIcon(pendingFile.name)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-medium text-carbon truncate">{pendingFile.name}</div>
                        <div className="text-[10px] text-slate">{fmtSize(pendingFile.size)}</div>
                      </div>
                      <button type="button" onClick={() => { setPendingFile(null); if (templateFileRef.current) templateFileRef.current.value = ""; }} className="text-slate hover:text-carbon">✕</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => templateFileRef.current?.click()}
                      className="w-full border-2 border-dashed border-chalk rounded-[8px] py-8 text-center text-[12px] text-slate hover:border-graphite/40 hover:bg-fog transition-colors">
                      <div className="text-3xl mb-2">📎</div>
                      <div className="font-medium text-carbon">Click para seleccionar</div>
                      <div className="text-[10px] mt-1 text-slate">PowerPoint · Word · Excel</div>
                    </button>
                  )}
                  <input ref={templateFileRef} type="file" accept=".pptx,.docx,.xlsx" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setPendingFile(f); setUploadName(prev => prev || f.name.replace(/\.[^.]+$/, "")); } }} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-graphite mb-1.5">Nombre *</label>
                  <input value={uploadName} onChange={e => setUploadName(e.target.value)}
                    placeholder="Ej: 2-Pager Inversión, Presentación LP..."
                    className="w-full border border-chalk rounded-[8px] px-3 py-2 text-[13px] text-carbon placeholder:text-slate/50 focus:outline-none focus:border-carbon"/>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-graphite mb-1.5">Descripción (opcional)</label>
                  <input value={uploadDesc} onChange={e => setUploadDesc(e.target.value)}
                    placeholder="Para qué se usa esta plantilla..."
                    className="w-full border border-chalk rounded-[8px] px-3 py-2 text-[13px] text-carbon placeholder:text-slate/50 focus:outline-none focus:border-carbon"/>
                </div>
                {uploadErr && <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] p-3">{uploadErr}</div>}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => { setShowUpload(false); setPendingFile(null); setUploadErr(null); }}
                    className="flex-1 border border-chalk rounded-[8px] py-2 text-[13px] text-graphite hover:bg-fog">Cancelar</button>
                  <button type="submit" disabled={uploading || !pendingFile || !uploadName.trim()}
                    className="flex-1 bg-carbon text-white rounded-[8px] py-2 text-[13px] font-medium hover:bg-graphite disabled:opacity-40 disabled:cursor-not-allowed">
                    {uploading ? "Subiendo…" : "Subir"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Preview modal */}
        {genResult && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-[16px] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
              {/* Header */}
              <div className="px-6 py-4 border-b border-chalk flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-[15px] font-semibold text-carbon">Vista previa del documento</h3>
                  <p className="text-[11px] text-slate mt-0.5">
                    {genResult.replacements.length > 0
                      ? `${genResult.replacements.length} cambio${genResult.replacements.length > 1 ? "s" : ""} realizados por la IA`
                      : "Documento listo — sin cambios de IA detectados"}
                  </p>
                </div>
                <button onClick={() => setGenResult(null)} className="text-slate hover:text-carbon p-1">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">

                {/* No changes warning */}
                {genResult.replacements.length === 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-[10px] p-4 space-y-2">
                    <div className="text-[13px] font-semibold text-yellow-800">⚠️ La IA no generó cambios</div>
                    <div className="text-[11px] text-yellow-700 space-y-1">
                      {genResult._debug && (
                        <div className="font-mono bg-yellow-100 rounded p-2 space-y-0.5">
                          <div>empresa seleccionada: <b>{genResult._debug.hadCompany ? "sí" : "NO"}</b></div>
                          <div>archivos adjuntos: <b>{genResult._debug.hadContextFiles}</b></div>
                          <div>instrucciones: <b>{genResult._debug.hadUserPrompt ? "sí" : "NO"}</b></div>
                          <div>API key: <b>{genResult._debug.hadApiKey ? "sí" : "NO"}</b></div>
                          <div>texto extraído: <b>{genResult._debug.templateTextLength} chars</b></div>
                        </div>
                      )}
                      <p>Si la API key está activa y hay empresa/instrucciones, la IA debería generar cambios. Si dice "NO" en empresa y API key, configúralos primero.</p>
                    </div>
                  </div>
                )}

                {/* Replacements list */}
                {genResult.replacements.length > 0 && (
                  <div>
                    <div className="text-[12px] font-semibold text-carbon mb-2">Cambios aplicados</div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {genResult.replacements.slice(0, 30).map((r, i) => (
                        <div key={i} className="flex items-start gap-2 bg-fog rounded-[8px] px-3 py-2 text-[11px]">
                          <span className="text-slate shrink-0 mt-0.5 line-through truncate max-w-[40%]">{r.find}</span>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 mt-0.5 text-carbon">
                            <path d="M1 5h8M6 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span className="text-carbon font-medium truncate">{r.replace}</span>
                        </div>
                      ))}
                      {genResult.replacements.length > 30 && (
                        <div className="text-[10px] text-slate pl-2">…y {genResult.replacements.length - 30} cambios más</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Preview text */}
                {genResult.previewText && (
                  <div>
                    <div className="text-[12px] font-semibold text-carbon mb-2">Contenido del documento generado</div>
                    <pre className="bg-fog border border-chalk rounded-[8px] p-4 text-[11px] text-graphite whitespace-pre-wrap leading-relaxed overflow-y-auto max-h-64 font-mono">
                      {genResult.previewText
                        .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
                        .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#xA;/g, "\n")}
                    </pre>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-chalk flex gap-3 shrink-0">
                <button onClick={() => setGenResult(null)}
                  className="flex-1 border border-chalk rounded-[9px] py-2.5 text-[13px] text-graphite hover:bg-fog transition-colors">
                  Cancelar
                </button>
                <button onClick={() => downloadResult(genResult)}
                  className="flex-1 bg-carbon text-white rounded-[9px] py-2.5 text-[13px] font-semibold hover:bg-graphite transition-colors flex items-center justify-center gap-2">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M6.5 1v8M3.5 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M1 10v1.5A1.5 1.5 0 002.5 13h8a1.5 1.5 0 001.5-1.5V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  Descargar {genResult.filename.split(".").pop()?.toUpperCase()}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!selected && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="text-5xl mb-4">✨</div>
            <h3 className="text-[20px] font-semibold text-carbon mb-2">Generador de Documentos con IA</h3>
            <p className="text-[13px] text-slate max-w-md mb-8 leading-relaxed">
              Sube tu presentación o documento existente. Adjunta archivos de respaldo
              (PDFs, Excels con datos, reports) y la IA extrae la información relevante
              para construir el documento personalizado.
            </p>
            <div className="grid grid-cols-3 gap-4 mb-8 w-full max-w-sm">
              {(["pptx","docx","xlsx"] as const).map(type => (
                <div key={type} className={`rounded-[12px] border-2 p-5 text-center ${TYPE_COLOR[type]}`}>
                  <div className="text-3xl mb-2">{TYPE_ICON[type]}</div>
                  <div className="text-[12px] font-semibold">{TYPE_LABEL[type]}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-6 py-3 bg-carbon text-white rounded-[10px] text-[14px] font-medium hover:bg-graphite transition-colors shadow-sm">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <line x1="6.5" y1="1" x2="6.5" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="1" y1="6.5" x2="12" y2="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Subir primera plantilla
            </button>
          </div>
        )}

        {/* Template selected — generation panel */}
        {selected && (
          <div className="py-10 px-6 space-y-4">

            {/* Template header */}
            <div className="flex items-center gap-4">
              <div className="text-5xl">{TYPE_ICON[selected.type]}</div>
              <div>
                <h1 className="text-[20px] font-semibold text-carbon">{selected.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${TYPE_COLOR[selected.type]}`}>{TYPE_LABEL[selected.type]}</span>
                  {selected.fileSize && <span className="text-[11px] text-slate">{fmtSize(selected.fileSize)}</span>}
                  <span className="text-[11px] text-green-600 font-medium">✨ IA</span>
                </div>
                {selected.description && <p className="text-[12px] text-slate mt-1">{selected.description}</p>}
              </div>
            </div>

            {/* Step 1 — Company (optional) */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-carbon text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                <div>
                  <div className="text-[13px] font-semibold text-carbon">Empresa <span className="text-[11px] font-normal text-slate">(Opcional)</span></div>
                  <div className="text-[10px] text-slate">Si seleccionas una, la IA usa sus datos financieros. Puedes generar sin empresa usando solo instrucciones.</div>
                </div>
              </div>
              <select value={companyId} onChange={e => setCompanyId(e.target.value)}
                className="w-full border border-chalk rounded-[8px] px-3 py-2.5 text-[13px] text-carbon bg-white focus:outline-none focus:border-carbon">
                <option value="">— Sin empresa específica —</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.sector ? ` · ${c.sector}` : ""}{c.stage ? ` · ${c.stage}` : ""}</option>
                ))}
              </select>
              {companyId && (
                <div className="mt-2 text-[10px] text-slate">
                  La IA usará los datos financieros, comparables y métricas de esta empresa desde el radar.
                </div>
              )}
            </div>

            {/* Step 2 — Context files */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-carbon text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                  <div>
                    <div className="text-[13px] font-semibold text-carbon">Archivos de respaldo</div>
                    <div className="text-[10px] text-slate">Opcional — La IA los lee para enriquecer el documento</div>
                  </div>
                </div>
                <button onClick={() => contextFileRef.current?.click()}
                  className="text-[11px] font-medium text-carbon border border-chalk px-3 py-1.5 rounded-[7px] hover:bg-fog transition-colors">
                  + Agregar
                </button>
              </div>
              <input ref={contextFileRef} type="file" multiple
                accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg"
                className="hidden"
                onChange={e => { if (e.target.files) addContextFiles(e.target.files); e.target.value = ""; }}/>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setCtxDragOver(true); }}
                onDragLeave={() => setCtxDragOver(false)}
                onDrop={e => { e.preventDefault(); setCtxDragOver(false); addContextFiles(e.dataTransfer.files); }}
                onClick={() => contextFileRef.current?.click()}
                className={`rounded-[8px] border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
                  ctxDragOver ? "border-carbon bg-fog" : contextFiles.length === 0 ? "border-chalk hover:border-graphite/40 hover:bg-fog/50" : "border-chalk/40"}`}>
                {contextFiles.length === 0 ? (
                  <div>
                    <div className="text-2xl mb-1">📎</div>
                    <div className="text-[12px] text-slate">Arrastra o click para agregar archivos</div>
                    <div className="text-[10px] text-slate/60 mt-0.5">PDF · Word · Excel · PowerPoint · TXT · Imágenes</div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate">+ Agregar más archivos</div>
                )}
              </div>

              {/* File list */}
              {contextFiles.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {contextFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2.5 bg-fog rounded-[8px] px-3 py-2">
                      <span className="text-base shrink-0">{fileIcon(f.name)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-medium text-carbon truncate">{f.name}</div>
                        <div className="text-[10px] text-slate">{fmtSize(f.size)}</div>
                      </div>
                      <button onClick={() => removeContextFile(i)} className="text-slate hover:text-carbon p-1 rounded hover:bg-chalk transition-colors">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                  <div className="text-[10px] text-slate pl-1">
                    ✓ La IA leerá estos {contextFiles.length} archivo{contextFiles.length > 1 ? "s" : ""} para extraer información adicional
                  </div>
                </div>
              )}

              {/* API key requirement */}
              {contextFiles.length > 0 && !hasApiKey && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-[8px] p-3">
                  <div className="text-[11px] text-yellow-800 font-medium mb-1">⚠️ Se requiere API key</div>
                  <div className="text-[10px] text-yellow-700 mb-2">
                    Para usar archivos de respaldo con IA, necesitas configurar tu API key de Anthropic.
                  </div>
                  <a href="/settings" className="text-[10px] font-semibold text-yellow-700 underline hover:text-yellow-900">
                    Ir a Configuración →
                  </a>
                </div>
              )}

              {/* What to upload */}
              <div className="mt-3 pt-3 border-t border-chalk">
                <div className="text-[10px] text-slate font-medium mb-1">¿Qué puedes subir?</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {[
                    ["📕 PDF", "Estados financieros, reportes"],
                    ["📋 Excel", "Modelos financieros, datos históricos"],
                    ["📊 PowerPoint", "Decks anteriores de la empresa"],
                    ["📝 Word", "Due diligence, memos previos"],
                    ["🖼 Imagen", "Screenshots, tablas, logos"],
                    ["📃 TXT / CSV", "Data exportada de sistemas"],
                  ].map(([type, desc]) => (
                    <div key={type} className="flex gap-1.5 py-0.5">
                      <span className="text-[10px] shrink-0">{type}</span>
                      <span className="text-[10px] text-slate/70">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Step 3 — User prompt */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-carbon text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                <div>
                  <div className="text-[13px] font-semibold text-carbon">Instrucciones para la IA <span className="text-[11px] font-normal text-slate">(Opcional)</span></div>
                  <div className="text-[10px] text-slate">Especifica qué quieres que haga la IA con este documento</div>
                </div>
              </div>
              <textarea
                value={userPrompt}
                onChange={e => setUserPrompt(e.target.value)}
                rows={4}
                placeholder={"Ejemplos:\n• Adapta esta presentación de Ben & Frank para una empresa de tecnología educativa en Brasil. Usa los datos financieros de los archivos adjuntos.\n• Traduce al español y ajusta el tono para un fondo de LATAM.\n• Reemplaza los datos financieros con los del Excel adjunto y actualiza el año a 2026.\n• Crea una versión genérica sin empresa específica que sirva como plantilla reutilizable."}
                className="w-full border border-chalk rounded-[8px] px-3 py-2.5 text-[12px] text-carbon placeholder:text-slate/40 focus:outline-none focus:border-carbon resize-none leading-relaxed"
              />
              {userPrompt.trim() && !hasApiKey && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-[7px] px-2.5 py-1.5">
                  <span>⚠️</span>
                  <span>Se requiere API key de Anthropic para usar instrucciones personalizadas. <a href="/settings" className="underline font-medium">Configurar →</a></span>
                </div>
              )}
            </div>

            {/* Step 4 — Generate */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-5 h-5 rounded-full bg-carbon text-white text-[10px] font-bold flex items-center justify-center shrink-0">4</span>
                <div className="text-[13px] font-semibold text-carbon">Generar documento</div>
              </div>

              {genErr && (
                <div className="mb-4 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] p-3">{genErr}</div>
              )}
              {genSuccess && (
                <div className="mb-4 text-[12px] text-green-700 bg-green-50 border border-green-200 rounded-[8px] p-3 flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="6" fill="#22c55e"/>
                    <polyline points="4,7 6,9 10,5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  ¡Documento generado y descargado exitosamente!
                </div>
              )}

              {/* Progress indicator */}
              {generating && (
                <div className="mb-4 rounded-[10px] border border-chalk bg-fog p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="animate-spin w-4 h-4 text-carbon shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                    </svg>
                    <span className="text-[13px] font-semibold text-carbon">{GEN_STEPS[genStep]}</span>
                  </div>
                  {/* Step dots */}
                  <div className="flex items-center gap-1.5">
                    {GEN_STEPS.map((_, i) => (
                      <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${
                        i < genStep ? "bg-carbon flex-1" :
                        i === genStep ? "bg-carbon/60 flex-1 animate-pulse" :
                        "bg-chalk flex-1"}`} />
                    ))}
                  </div>
                  <p className="text-[10px] text-slate mt-2">
                    La generación puede tomar entre 30 y 90 segundos según el tamaño del documento
                  </p>
                </div>
              )}

              <button onClick={handleGenerate} disabled={generating || !selected}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-carbon text-white rounded-[10px] text-[14px] font-semibold hover:bg-graphite disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {generating ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                    </svg>
                    Generando…
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                      <path d="M7.5 1v9M4.5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M2 11v1.5A1.5 1.5 0 003.5 14h8a1.5 1.5 0 001.5-1.5V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                    ✨ Generar con IA y Descargar
                  </>
                )}
              </button>


              {/* Advanced Build button — PPTX only */}
              {selected?.type === "pptx" && (
                <div className="mt-3 pt-3 border-t border-chalk">
                  <div className="text-[10px] text-slate mb-2 font-medium">Modo avanzado — gráficas nativas editables en PowerPoint</div>
                  {buildErr && (
                    <div className="mb-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-[7px] p-2.5">{buildErr}</div>
                  )}
                  <button onClick={handleBuild} disabled={building || generating || !selected}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-[#004F46] text-white rounded-[10px] text-[13px] font-semibold hover:bg-[#00403A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {building ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                        </svg>
                        Construyendo presentación…
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/>
                          <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/>
                          <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor"/>
                          <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/>
                        </svg>
                        Construir con gráficas nativas
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-chalk flex items-start gap-2">
                <span className="text-sm shrink-0">🔒</span>
                <div className="text-[10px] text-slate leading-relaxed">
                  Tu plantilla original nunca se modifica. Los archivos de respaldo se usan solo en esta generación y no se guardan en el servidor.
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
