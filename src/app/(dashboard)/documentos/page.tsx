"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutTemplate, FileText, Table2, File, ImageIcon,
  Paperclip, Sparkles, Target, Flag, Lock, FileCode, ChevronLeft,
  FolderOpen, Eye, Download, Trash2, Loader2, X,
} from "lucide-react";
import { usePersistentState } from "@/lib/usePersistentState";
import { useDocJobs } from "../DocJobsContext";

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
interface DeckSlide {
  index: number;
  type: "cover" | "divider" | "slide" | "back_cover";
  title?: string;
  subtitle?: string;
  section?: string;
  takeaway?: string;
  chart?: string;
}
interface DeckPlan {
  deck_title: string;
  deck_subtitle?: string;
  company?: string;
  slides: DeckSlide[];
}

type DocType = "pptx" | "docx" | "twopager";

// The template a user picks here is never chosen by them — it's a single
// fixed asset per document type, managed by us. We key it off a reserved
// template name so no schema change is needed: whichever DocumentTemplate
// row has this exact name+type is "the" hardcoded template for that type.
// "twopager" has no uploaded template at all — it's generated from scratch.
const DEFAULT_TEMPLATE_NAME: Record<"pptx" | "docx", string> = {
  pptx: "PANDO Default PowerPoint Template",
  docx: "PANDO Default Word Template",
};
const DOC_TYPE_META: Record<DocType, { label: string; blurb: string; icon: (s: number) => React.ReactNode; color: string }> = {
  pptx: {
    label: "PowerPoint",
    blurb: "Build an investor presentation — cover, sections, native charts.",
    icon: (s) => <LayoutTemplate size={s} className="text-orange" />,
    color: "bg-orange/10 text-orange border-orange/30",
  },
  docx: {
    label: "Word",
    blurb: "Build a written document — memo, report, template-based.",
    icon: (s) => <FileText size={s} className="text-blue-600" />,
    color: "bg-blue-500/10 text-blue-600 border-blue-400/30",
  },
  twopager: {
    label: "Company 2-Pager",
    blurb: "A short investment brief with a customizable outline and length.",
    icon: (s) => <Flag size={s} className="text-[#004F46]" />,
    color: "bg-[#004F46]/10 text-[#004F46] border-[#004F46]/30",
  },
};

interface TwoPagerSectionUI { id: string; title: string; guidance: string; included: boolean }
interface TwoPagerPlan {
  title?: string;
  subtitle?: string;
  sections: { heading: string; paragraphs: string[] }[];
}

const TYPE_COLOR: Record<string, string> = {
  pptx: "bg-orange/10 text-orange border-orange/30",
  docx: "bg-blue-500/10 text-blue-600 border-blue-400/30",
  xlsx: "bg-green-500/10 text-green-700 border-green-400/30",
};
const TYPE_LABEL: Record<string, string> = { pptx: "PowerPoint", docx: "Word", xlsx: "Excel" };

function DocTypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  if (type === "pptx") return <LayoutTemplate size={size} className="text-orange" />;
  if (type === "docx") return <FileText size={size} className="text-blue-600" />;
  if (type === "xlsx") return <Table2 size={size} className="text-green-600" />;
  return <File size={size} className="text-graphite" />;
}

function FileTypeIcon({ name, size = 16 }: { name: string; size?: number }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return <FileText size={size} className="text-red-500" />;
  if (ext === "docx" || ext === "doc") return <FileText size={size} className="text-blue-500" />;
  if (ext === "pptx" || ext === "ppt") return <LayoutTemplate size={size} className="text-orange" />;
  if (ext === "xlsx" || ext === "xls") return <Table2 size={size} className="text-green-600" />;
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return <ImageIcon size={size} className="text-graphite" />;
  if (ext === "txt" || ext === "csv") return <FileCode size={size} className="text-graphite" />;
  return <File size={size} className="text-graphite" />;
}

// Each chunk is ≤3 MB so it stays under Vercel's 4.5 MB payload limit.
const CTX_CHUNK = 3 * 1024 * 1024;

interface LibraryItem {
  id: string; docType: string; name: string;
  fileUrl: string | null; fileSize: number | null; createdAt: string | null;
}

function fmtSize(b: number | null): string {
  if (!b) return "";
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

export default function DocumentosPage() {
  const { jobs, runJob, clearJob } = useDocJobs();
  const [templates, setTemplates]     = useState<DocTemplate[]>([]);
  const [companies, setCompanies]     = useState<Company[]>([]);
  // Persisted to sessionStorage (not plain useState) so navigating to another
  // page (e.g. Settings) and back doesn't lose an in-progress draft, form
  // inputs, or already-uploaded context files.
  const [docType, setDocType]         = usePersistentState<DocType | null>("documentos:docType", null);
  const [companyId, setCompanyId]     = usePersistentState("documentos:companyId", "");
  const [contextFiles, setContextFiles] = useState<File[]>([]); // raw File objects can't be persisted; see contextBlobUrls below
  const [userPrompt, setUserPrompt]    = usePersistentState("documentos:userPrompt", "");
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
  const [buildProgress, setBuildProgress] = useState<{ message: string; current: number; total: number } | null>(null);
  const [lastDownload, setLastDownload] = useState<{ url: string; filename: string } | null>(null);
  const [qaWarnings, setQaWarnings] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [planning, setPlanning]         = useState(false);
  const [planErr, setPlanErr]           = useState<string | null>(null);
  const [plan, setPlan]                 = usePersistentState<DeckPlan | null>("documentos:plan", null);
  const [planFeedback, setPlanFeedback] = usePersistentState("documentos:planFeedback", "");
  const [uploadingCtx, setUploadingCtx] = useState(false);
  // Kept in sync with (and reset alongside) contextFiles by array length —
  // not persisted, since raw File objects can't survive serialization and a
  // stale blobUrls list without matching files would silently misfire.
  const [contextBlobUrls, setContextBlobUrls] = useState<{ name: string; url: string; type: string }[]>([]);
  const [showUpload, setShowUpload]   = useState(false); // "set/replace default template" modal
  const [dragOver, setDragOver]       = useState(false);
  const [ctxDragOver, setCtxDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadDesc, setUploadDesc]   = useState("");
  const templateFileRef = useRef<HTMLInputElement>(null);
  const contextFileRef  = useRef<HTMLInputElement>(null);

  // ── Document Library (shared, manual-upload, flat — presentations & 2-pagers) ──
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryTab, setLibraryTab] = useState<"presentation" | "twopager">("presentation");
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libName, setLibName] = useState("");
  const [libFile, setLibFile] = useState<File | null>(null);
  const [libUploading, setLibUploading] = useState(false);
  const [libErr, setLibErr] = useState<string | null>(null);
  const libFileRef = useRef<HTMLInputElement>(null);

  const loadLibrary = useCallback(async (docType: "presentation" | "twopager") => {
    setLibraryLoading(true);
    const r = await fetch(`/api/document-library?docType=${docType}`);
    if (r.ok) setLibraryItems(await r.json());
    setLibraryLoading(false);
  }, []);
  useEffect(() => { if (showLibrary) loadLibrary(libraryTab); }, [showLibrary, libraryTab, loadLibrary]);

  async function uploadToLibrary() {
    if (!libFile || !libName.trim()) return;
    setLibErr(null);
    setLibUploading(true);
    try {
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(libFile.size / CTX_CHUNK) || 1;
      const chunkUrls: string[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = libFile.slice(i * CTX_CHUNK, (i + 1) * CTX_CHUNK);
        const fd = new FormData();
        fd.append("chunk", chunk);
        fd.append("uploadId", uploadId);
        fd.append("chunkIndex", String(i));
        fd.append("filename", libFile.name);
        const res = await fetch("/api/templates/chunk", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`Error uploading part ${i + 1}`);
        const { chunkUrl } = await res.json();
        chunkUrls.push(chunkUrl);
      }
      const finalRes = await fetch("/api/templates/chunk/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkUrls, filename: `library_${Date.now()}_${libFile.name}` }),
      });
      if (!finalRes.ok) throw new Error("Error assembling file");
      const { blobUrl } = await finalRes.json();

      const metaRes = await fetch("/api/document-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType: libraryTab, name: libName.trim(), fileUrl: blobUrl, fileSize: libFile.size }),
      });
      if (!metaRes.ok) throw new Error("Error saving to library");

      setLibName(""); setLibFile(null);
      if (libFileRef.current) libFileRef.current.value = "";
      loadLibrary(libraryTab);
    } catch (e) {
      setLibErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLibUploading(false);
    }
  }
  async function deleteLibraryItem(id: string) {
    await fetch(`/api/document-library/${id}`, { method: "DELETE" });
    loadLibrary(libraryTab);
  }
  function previewLibraryItem(url: string) {
    window.open(`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`, "_blank");
  }

  // ── 2-Pager specific state ────────────────────────────────────────────────
  const [pageCount, setPageCount] = usePersistentState("documentos:pageCount", 2);
  const [tpSections, setTpSections] = usePersistentState<TwoPagerSectionUI[]>("documentos:tpSections", []);
  const [tpSectionsLoaded, setTpSectionsLoaded] = usePersistentState("documentos:tpSectionsLoaded", false);
  const [tpPlan, setTpPlan] = usePersistentState<TwoPagerPlan | null>("documentos:tpPlan", null);
  const [tpEdits, setTpEdits] = usePersistentState<Record<number, string>>("documentos:tpEdits", {});
  const [tpFeedback, setTpFeedback] = usePersistentState("documentos:tpFeedback", "");
  const [tpPlanning, setTpPlanning] = useState(false);
  const [tpPlanErr, setTpPlanErr] = useState<string | null>(null);
  const [tpBuilding, setTpBuilding] = useState(false);
  const [tpBuildErr, setTpBuildErr] = useState<string | null>(null);
  const [tpLastDownload, setTpLastDownload] = useState<{ url: string; filename: string } | null>(null);

  useEffect(() => {
    if (docType !== "twopager" || tpSectionsLoaded) return;
    (async () => {
      const r = await fetch("/api/admin/twopager-sections");
      if (r.ok) {
        const d = await r.json();
        setTpSections((d.sections as { id: string; title: string; guidance: string }[]).map(s => ({ ...s, included: true })));
      }
      setTpSectionsLoaded(true);
    })();
  }, [docType, tpSectionsLoaded]);

  function updateTpSection(idx: number, patch: Partial<TwoPagerSectionUI>) {
    setTpSections(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }
  function removeTpSection(idx: number) {
    setTpSections(prev => prev.filter((_, i) => i !== idx));
  }
  function moveTpSection(idx: number, dir: -1 | 1) {
    setTpSections(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function addTpSection() {
    setTpSections(prev => [...prev, { id: crypto.randomUUID(), title: "New Section", guidance: "", included: true }]);
  }

  // These jobs run inside DocJobsContext (mounted once at the dashboard-layout
  // level), not this page component — so if the user navigates away (e.g. to
  // Settings) while a plan/build is in flight, the request keeps running and
  // still lands correctly instead of updating a component that no longer
  // exists. The effects below re-sync local UI state from the job whenever it
  // changes, including immediately on mount if it finished while away.
  useEffect(() => {
    const job = jobs.tpPlan;
    if (!job) return;
    setTpPlanning(job.status === "running");
    if (job.status === "error") setTpPlanErr(job.error ?? "Unknown error");
    if (job.status === "done") {
      setTpPlanErr(null);
      setTpPlan(job.result as TwoPagerPlan);
      setTpEdits({});
      setTpFeedback("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.tpPlan]);

  useEffect(() => {
    const job = jobs.tpBuild;
    if (!job) return;
    setTpBuilding(job.status === "running");
    if (job.status === "error") setTpBuildErr(job.error ?? "Unknown error");
    if (job.status === "done") {
      setTpBuildErr(null);
      setTpLastDownload(job.result as { url: string; filename: string });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.tpBuild]);

  async function handleTwoPagerPlan(feedback?: string) {
    const included = tpSections.filter(s => s.included);
    if (included.length === 0) {
      setTpPlanErr("Include at least one section");
      return;
    }
    setTpPlanErr(null);
    await runJob("tpPlan", async () => {
      const blobUrls = await ensureContextBlobsUploaded();
      const fd = new FormData();
      if (companyId) fd.append("companyId", companyId);
      if (userPrompt.trim()) fd.append("userPrompt", userPrompt.trim());
      if (feedback?.trim()) fd.append("feedback", feedback.trim());
      fd.append("pageCount", String(pageCount));
      fd.append("sections", JSON.stringify(included.map(s => ({ id: s.id, title: s.title, guidance: s.guidance }))));
      if (blobUrls.length) fd.append("blobUrls", JSON.stringify(blobUrls));

      const res = await fetch("/api/documents/twopager/plan", { method: "POST", body: fd });
      let j: { success?: boolean; plan?: TwoPagerPlan; companyName?: string; error?: string; raw?: string } = {};
      let rawText = "";
      try { rawText = await res.text(); j = JSON.parse(rawText); } catch { /* ignore */ }
      if (!res.ok || !j.success) {
        const detail = j.error ?? (rawText.length < 200 ? rawText : `HTTP ${res.status}`);
        throw new Error(j.raw ? `${detail} — Claude said: "${j.raw.slice(0, 200)}"` : (detail || `Error HTTP ${res.status}`));
      }
      return j.plan!;
    });
  }

  async function handleTwoPagerBuild() {
    if (!tpPlan) return;
    setTpBuildErr(null);

    const finalPlan: TwoPagerPlan = {
      title: tpPlan.title,
      subtitle: tpPlan.subtitle,
      sections: tpPlan.sections.map((s, i) => ({
        heading: s.heading,
        paragraphs: (tpEdits[i] ?? s.paragraphs.join("\n\n")).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean),
      })),
    };
    const selectedCompany = companies.find(c => c.id === companyId);

    await runJob("tpBuild", async () => {
      const res = await fetch("/api/documents/twopager/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedPlan: finalPlan, companyName: selectedCompany?.name ?? tpPlan.title }),
      });
      const j = await res.json().catch(() => ({})) as { file?: string; filename?: string; error?: string };
      if (!res.ok || !j.file) throw new Error(j.error ?? "Error building document");

      const bytes = Uint8Array.from(atob(j.file), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = j.filename!; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { url, filename: j.filename! };
    });
  }

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

  // The one hardcoded template for the currently chosen document type.
  // "twopager" has no uploaded template — it's generated from scratch.
  const selected: DocTemplate | null = docType && docType !== "twopager"
    ? templates.find(t => t.type === docType && t.name === DEFAULT_TEMPLATE_NAME[docType]) ?? null
    : null;

  function chooseDocType(t: DocType) {
    setDocType(t);
    setGenSuccess(false); setGenErr(null); setBuildErr(null); setPlanErr(null);
    setPlan(null); setPlanFeedback(""); setContextFiles([]); setContextBlobUrls([]);
    setGenResult(null); setLastDownload(null); setQaWarnings([]);
    setTpPlan(null); setTpEdits({}); setTpFeedback(""); setTpPlanErr(null); setTpBuildErr(null); setTpLastDownload(null);
  }
  function backToLanding() {
    setDocType(null);
  }

  const GEN_STEPS = [
    "Downloading template…",
    "Analyzing document structure…",
    "Loading company data…",
    "Processing with AI…",
    "Applying changes to document…",
  ];

  // Advance progress steps on a schedule while generating
  useEffect(() => {
    if (!generating) { setGenStep(0); return; }
    const delays = [0, 3000, 7000, 13000, 28000];
    const timers = delays.map((d, i) => setTimeout(() => setGenStep(i), d));
    return () => timers.forEach(clearTimeout);
  }, [generating]);

  // ── Set / replace the hardcoded default template for docType ──────────────
  // Files up to 25 MB: chunked upload (3 MB per chunk) → Vercel Blob assembly
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const CHUNK_SIZE        =  3 * 1024 * 1024; // 3 MB — well under Vercel's 4.5 MB limit

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingFile || !docType || docType === "twopager") return;
    if (pendingFile.size > MAX_UPLOAD_BYTES) {
      setUploadErr(`File too large (${fmtSize(pendingFile.size)}). Maximum size is 25 MB.`);
      return;
    }
    const ext = pendingFile.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== docType) {
      setUploadErr(`Please upload a .${docType} file.`);
      return;
    }

    setUploading(true); setUploadErr(null);
    const uploadId = crypto.randomUUID();

    try {
      const totalChunks = Math.ceil(pendingFile.size / CHUNK_SIZE);
      const chunkUrls: string[] = [];

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
          let msg = `Part ${i + 1}/${totalChunks} failed (HTTP ${res.status})`;
          try { msg = JSON.parse(text).error ?? msg; } catch { if (text) msg += `: ${text.slice(0, 300)}`; }
          throw new Error(msg);
        }
        const { chunkUrl } = await res.json();
        chunkUrls.push(chunkUrl);
      }

      const finalRes = await fetch("/api/templates/chunk/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkUrls, filename: pendingFile.name }),
      });
      if (!finalRes.ok) {
        const j = await finalRes.json().catch(() => ({}));
        throw new Error((j as any).error ?? "Error assembling file");
      }
      const { blobUrl } = await finalRes.json();

      // Register as THE default template for this doc type (fixed reserved name)
      const regRes = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl,
          name: DEFAULT_TEMPLATE_NAME[docType],
          description: uploadDesc.trim() || undefined,
          type: docType,
        }),
      });
      if (!regRes.ok) {
        const j = await regRes.json().catch(() => ({}));
        throw new Error((j as any).error ?? "Error registering template");
      }

      const t = await regRes.json() as DocTemplate;
      // Keep only the newest row for this type+name so lookup is unambiguous
      setTemplates(prev => [t, ...prev.filter(x => !(x.type === docType && x.name === DEFAULT_TEMPLATE_NAME[docType]))]);
      setShowUpload(false); setPendingFile(null); setUploadDesc("");

    } catch (err: any) {
      setUploadErr(err?.message ?? "Error uploading file");
    }

    setUploading(false);
  }

  // ── Generate document ──────────────────────────────────────────────────────
  useEffect(() => {
    const job = jobs.generate;
    if (!job) return;
    setGenerating(job.status === "running");
    if (job.status === "error") setGenErr(job.error ?? "Unknown error");
    if (job.status === "done") { setGenErr(null); setGenResult(job.result as GenResult); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.generate]);

  async function handleGenerate() {
    if (!selected) return;

    if ((contextFiles.length > 0 || userPrompt.trim() || companyId) && !hasApiKey) {
      setGenErr("You need to configure your Anthropic API key in Settings to use this feature");
      return;
    }

    setGenErr(null); setGenSuccess(false);

    const fd = new FormData();
    fd.append("templateId", selected.id);
    if (companyId) fd.append("companyId", companyId);
    if (userPrompt.trim()) fd.append("userPrompt", userPrompt.trim());
    for (const f of contextFiles) fd.append("files", f);

    await runJob("generate", async () => {
      const res = await fetch("/api/documents/generate", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({})) as any;
      if (!res.ok) {
        if (j.code === "NO_API_KEY") throw new Error("⚠ " + j.error + " → Go to Settings to add it");
        throw new Error((j.error ?? "Generation error") + (j.detail ? `: ${j.detail}` : ""));
      }
      return j as GenResult;
    });
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
    clearJob("generate");
    setGenSuccess(true);
    setTimeout(() => setGenSuccess(false), 5000);
  }

  // ── Upload context files via chunked upload (reuses template chunk endpoints) ──
  // Each chunk is ≤3 MB so it stays under Vercel's 4.5 MB payload limit.

  async function ensureContextBlobsUploaded(): Promise<{ name: string; url: string; type: string }[]> {
    if (contextFiles.length === 0) return [];
    if (contextBlobUrls.length === contextFiles.length) return contextBlobUrls;
    setUploadingCtx(true);
    const results: { name: string; url: string; type: string }[] = [];
    for (const file of contextFiles) {
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(file.size / CTX_CHUNK) || 1;
      const chunkUrls: string[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(i * CTX_CHUNK, (i + 1) * CTX_CHUNK);
        const fd = new FormData();
        fd.append("chunk", chunk);
        fd.append("uploadId", uploadId);
        fd.append("chunkIndex", String(i));
        fd.append("filename", file.name);
        const res = await fetch("/api/templates/chunk", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`Error uploading ${file.name} (part ${i + 1})`);
        const { chunkUrl } = await res.json();
        chunkUrls.push(chunkUrl);
      }
      const finalRes = await fetch("/api/templates/chunk/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkUrls, filename: `ctx_${Date.now()}_${file.name}` }),
      });
      if (!finalRes.ok) throw new Error(`Error assembling ${file.name}`);
      const { blobUrl } = await finalRes.json();
      results.push({ name: file.name, url: blobUrl, type: file.type });
    }
    setContextBlobUrls(results);
    setUploadingCtx(false);
    return results;
  }

  // ── Plan-first workflow (PPTX build mode) ─────────────────────────────────
  useEffect(() => {
    const job = jobs.pptxPlan;
    if (!job) return;
    setPlanning(job.status === "running");
    if (job.status === "error") setPlanErr(job.error ?? "Unknown error");
    if (job.status === "done") { setPlanErr(null); setPlan(job.result as DeckPlan); setPlanFeedback(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.pptxPlan]);

  async function handlePlan(feedback?: string) {
    if (!selected || selected.type !== "pptx") return;
    setPlanErr(null);
    await runJob("pptxPlan", async () => {
      const blobUrls = await ensureContextBlobsUploaded();
      const fd = new FormData();
      if (companyId) fd.append("companyId", companyId);
      if (userPrompt.trim()) fd.append("userPrompt", userPrompt.trim());
      if (feedback?.trim()) fd.append("feedback", feedback.trim());
      if (blobUrls.length) fd.append("blobUrls", JSON.stringify(blobUrls));

      const res = await fetch("/api/documents/plan", { method: "POST", body: fd });
      let j: { success?: boolean; plan?: DeckPlan; error?: string; raw?: string } = {};
      let rawText = "";
      try { rawText = await res.text(); j = JSON.parse(rawText); } catch { /* ignore */ }
      if (!res.ok || !j.success) {
        const detail = j.error ?? (rawText.length < 200 ? rawText : `HTTP ${res.status}`);
        throw new Error(j.raw ? `${detail} — Claude said: "${j.raw.slice(0, 200)}"` : (detail || `Error HTTP ${res.status}`));
      }
      return j.plan!;
    });
  }

  interface PptxBuildOutcome {
    cancelled: boolean;
    url?: string;
    filename?: string;
  }

  useEffect(() => {
    const job = jobs.pptxBuild;
    if (!job) return;
    setBuilding(job.status === "running");
    if (job.status === "running") return; // let in-flight progress ticks (best-effort) keep showing
    setBuildProgress(null);
    if (job.status === "error") { setBuildErr(job.error ?? "Unknown error"); return; }
    if (job.status === "done") {
      setBuildErr(null);
      const outcome = job.result as PptxBuildOutcome;
      if (!outcome.cancelled && outcome.url && outcome.filename) {
        setLastDownload({ url: outcome.url, filename: outcome.filename });
        setPlan(null); setPlanFeedback("");
        setGenSuccess(true);
        setTimeout(() => setGenSuccess(false), 8000);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.pptxBuild]);

  async function handleBuildFromPlan() {
    if (!selected || selected.type !== "pptx") return;
    setBuildErr(null);
    setQaWarnings([]);
    setBuildProgress({ message: "Starting…", current: 0, total: 0 });

    const controller = new AbortController();
    abortRef.current = controller;

    await runJob("pptxBuild", async (): Promise<PptxBuildOutcome> => {
      let blobUrls = contextBlobUrls;
      if (contextFiles.length > 0 && blobUrls.length !== contextFiles.length) {
        blobUrls = await ensureContextBlobsUploaded();
      }

      const fd = new FormData();
      fd.append("templateId", selected.id);
      if (companyId) fd.append("companyId", companyId);
      if (userPrompt.trim()) fd.append("userPrompt", userPrompt.trim());
      if (plan) fd.append("approvedPlan", JSON.stringify(plan));
      if (blobUrls.length) fd.append("blobUrls", JSON.stringify(blobUrls));

      try {
        const res = await fetch("/api/documents/build", {
          method: "POST",
          body: fd,
          signal: controller.signal,
        });

        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const pptxChunks: string[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            let event: { type: string; message?: string; current?: number; total?: number; index?: number; data?: string; filename?: string; slide_count?: number; warnings?: string[] };
            try { event = JSON.parse(raw); } catch { continue; }

            if (event.type === "progress") {
              setBuildProgress({ message: event.message ?? "", current: event.current ?? 0, total: event.total ?? 0 });
            } else if (event.type === "chunk") {
              if (event.index !== undefined) pptxChunks[event.index] = event.data ?? "";
            } else if (event.type === "qa_warnings") {
              setQaWarnings(event.warnings ?? []);
            } else if (event.type === "done") {
              const base64 = pptxChunks.join("");
              const mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
              const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
              const blob = new Blob([bytes], { type: mime });
              const url = URL.createObjectURL(blob);
              const dlFilename = event.filename!;
              const a = document.createElement("a");
              a.href = url;
              a.download = dlFilename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
              return { cancelled: false, url, filename: dlFilename };
            } else if (event.type === "error") {
              throw new Error(event.message ?? "Unknown error");
            } else if (event.type === "cancelled") {
              return { cancelled: true };
            }
          }
        }
        throw new Error("Stream ended unexpectedly");
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return { cancelled: true };
        throw err;
      }
    });
  }

  function handleCancelBuild() {
    abortRef.current?.abort();
    setBuilding(false);
    setBuildProgress(null);
  }

  // ── Context file drag & drop ───────────────────────────────────────────────
  function addContextFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    setContextFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...arr.filter(f => !existing.has(f.name + f.size))];
    });
    setContextBlobUrls([]);
  }
  function removeContextFile(idx: number) {
    setContextFiles(prev => prev.filter((_, i) => i !== idx));
    setContextBlobUrls([]);
  }

  function handleTemplateDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { setPendingFile(f); setShowUpload(true); }
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto bg-mist">

        {/* Set / replace default template modal */}
        {showUpload && docType && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-[14px] shadow-xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-[15px] font-semibold text-carbon">
                    {selected ? "Replace" : "Set up"} the {DOC_TYPE_META[docType].label} template
                  </h3>
                  <p className="text-[11px] text-slate mt-0.5">
                    This becomes the fixed template used for every {DOC_TYPE_META[docType].label} document — users won&apos;t choose between templates.
                  </p>
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
                      <span className="shrink-0"><FileTypeIcon name={pendingFile.name} size={18} /></span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-medium text-carbon truncate">{pendingFile.name}</div>
                        <div className="text-[10px] text-slate">{fmtSize(pendingFile.size)}</div>
                      </div>
                      <button type="button" onClick={() => { setPendingFile(null); if (templateFileRef.current) templateFileRef.current.value = ""; }} className="text-slate hover:text-carbon">✕</button>
                    </div>
                  ) : (
                    <button type="button"
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleTemplateDrop}
                      onClick={() => templateFileRef.current?.click()}
                      className={`w-full border-2 border-dashed rounded-[8px] py-8 text-center text-[12px] transition-colors ${
                        dragOver ? "border-carbon bg-fog text-carbon" : "border-chalk text-slate hover:border-graphite/40 hover:bg-fog"}`}>
                      <div className="flex justify-center mb-2"><Paperclip size={26} className="text-chalk" /></div>
                      <div className="font-medium text-carbon">Click or drop to select</div>
                      <div className="text-[10px] mt-1 text-slate">.{docType} file only</div>
                    </button>
                  )}
                  <input ref={templateFileRef} type="file" accept={`.${docType}`} className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setPendingFile(f); }} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-graphite mb-1.5">Description (optional)</label>
                  <input value={uploadDesc} onChange={e => setUploadDesc(e.target.value)}
                    placeholder="Internal note about this template..."
                    className="w-full border border-chalk rounded-[8px] px-3 py-2 text-[13px] text-carbon placeholder:text-slate/50 focus:outline-none focus:border-carbon"/>
                </div>
                {uploadErr && <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] p-3">{uploadErr}</div>}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => { setShowUpload(false); setPendingFile(null); setUploadErr(null); }}
                    className="flex-1 border border-chalk rounded-[8px] py-2 text-[13px] text-graphite hover:bg-fog">Cancel</button>
                  <button type="submit" disabled={uploading || !pendingFile}
                    className="flex-1 bg-orange text-white rounded-[8px] py-2 text-[13px] font-medium hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed">
                    {uploading ? "Uploading…" : "Save"}
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
                  <h3 className="text-[15px] font-semibold text-carbon">Document preview</h3>
                  <p className="text-[11px] text-slate mt-0.5">
                    {genResult.replacements.length > 0
                      ? `${genResult.replacements.length} change${genResult.replacements.length > 1 ? "s" : ""} made by AI`
                      : "Document ready — no AI changes detected"}
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

                {genResult.replacements.length === 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-[10px] p-4 space-y-2">
                    <div className="text-[13px] font-semibold text-yellow-800">⚠ AI did not generate changes</div>
                    <div className="text-[11px] text-yellow-700 space-y-1">
                      {genResult._debug && (
                        <div className="font-mono bg-yellow-100 rounded p-2 space-y-0.5">
                          <div>company selected: <b>{genResult._debug.hadCompany ? "yes" : "NO"}</b></div>
                          <div>attached files: <b>{genResult._debug.hadContextFiles}</b></div>
                          <div>instructions: <b>{genResult._debug.hadUserPrompt ? "yes" : "NO"}</b></div>
                          <div>API key: <b>{genResult._debug.hadApiKey ? "yes" : "NO"}</b></div>
                          <div>extracted text: <b>{genResult._debug.templateTextLength} chars</b></div>
                        </div>
                      )}
                      <p>If the API key is active and there is a company/instructions, AI should generate changes. If it says &quot;NO&quot; for company and API key, configure them first.</p>
                    </div>
                  </div>
                )}

                {genResult.replacements.length > 0 && (
                  <div>
                    <div className="text-[12px] font-semibold text-carbon mb-2">Changes applied</div>
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
                        <div className="text-[10px] text-slate pl-2">…and {genResult.replacements.length - 30} more changes</div>
                      )}
                    </div>
                  </div>
                )}

                {genResult.previewText && (
                  <div>
                    <div className="text-[12px] font-semibold text-carbon mb-2">Generated document content</div>
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
                  Cancel
                </button>
                <button onClick={() => downloadResult(genResult)}
                  className="flex-1 bg-orange text-white rounded-[9px] py-2.5 text-[13px] font-semibold hover:opacity-85 transition-colors flex items-center justify-center gap-2">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M6.5 1v8M3.5 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M1 10v1.5A1.5 1.5 0 002.5 13h8a1.5 1.5 0 001.5-1.5V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  Download {genResult.filename.split(".").pop()?.toUpperCase()}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Document Library modal — manual uploads, shared across the whole team */}
        {showLibrary && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-[14px] shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-chalk shrink-0">
                <h3 className="text-[15px] font-semibold text-carbon">Document Library</h3>
                <button onClick={() => setShowLibrary(false)} className="text-slate hover:text-carbon"><X size={16} /></button>
              </div>

              <div className="flex gap-2 px-6 pt-4 shrink-0">
                <button onClick={() => setLibraryTab("presentation")}
                  className={`px-3 py-1.5 text-[12px] font-medium rounded-[7px] transition-colors ${libraryTab === "presentation" ? "bg-carbon text-white" : "border border-chalk text-slate hover:bg-fog"}`}>
                  Presentations
                </button>
                <button onClick={() => setLibraryTab("twopager")}
                  className={`px-3 py-1.5 text-[12px] font-medium rounded-[7px] transition-colors ${libraryTab === "twopager" ? "bg-carbon text-white" : "border border-chalk text-slate hover:bg-fog"}`}>
                  2-Pagers
                </button>
              </div>

              <div className="p-6 pt-4 space-y-4 overflow-y-auto flex-1">
                <div>
                  <p className="text-[11px] text-slate mb-3">
                    Not saved automatically — upload a finished {libraryTab === "presentation" ? "presentation" : "2-pager"} here so anyone on the team can find and open it.
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-slate">Name</span>
                      <input
                        type="text" value={libName} onChange={e => setLibName(e.target.value)}
                        placeholder="e.g. Acme Co. — Investor Deck v2"
                        className="w-full mt-1 px-2.5 py-1.5 text-[12px] bg-fog border border-chalk rounded-[6px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange"
                      />
                    </div>
                    <button type="button" onClick={() => libFileRef.current?.click()}
                      className="px-3 py-[7px] text-[12px] border border-chalk rounded-[6px] text-carbon hover:bg-fog whitespace-nowrap max-w-[120px] truncate">
                      {libFile ? libFile.name : "Choose file"}
                    </button>
                    <input ref={libFileRef} type="file" className="hidden"
                      onChange={e => setLibFile(e.target.files?.[0] ?? null)} />
                    <button onClick={uploadToLibrary} disabled={libUploading || !libFile || !libName.trim()}
                      className="px-4 py-1.5 bg-orange text-white rounded-[6px] text-[12px] font-medium hover:opacity-85 disabled:opacity-40 transition-colors flex items-center gap-1.5 whitespace-nowrap">
                      {libUploading && <Loader2 size={13} className="animate-spin" />}
                      {libUploading ? "Uploading…" : "Upload"}
                    </button>
                  </div>
                  {libErr && <div className="mt-2 rounded-[8px] p-2.5 text-[12px] border bg-red-50 text-red-700 border-red-200">{libErr}</div>}
                </div>

                {libraryLoading ? (
                  <div className="text-center py-6 text-slate text-[12px]">Loading…</div>
                ) : libraryItems.length === 0 ? (
                  <div className="text-center py-6 text-slate text-[12px]">Nothing uploaded yet.</div>
                ) : (
                  <div className="space-y-2">
                    {libraryItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between px-3 py-2.5 border border-chalk rounded-[8px]">
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-carbon truncate">{item.name}</div>
                          <div className="text-[11px] text-slate">
                            {fmtSize(item.fileSize)}
                            {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          {item.fileUrl && (
                            <>
                              <button onClick={() => previewLibraryItem(item.fileUrl!)} title="Preview" className="text-slate hover:text-carbon"><Eye size={15} /></button>
                              <a href={item.fileUrl} download className="text-slate hover:text-carbon" title="Download"><Download size={15} /></a>
                            </>
                          )}
                          <button onClick={() => deleteLibraryItem(item.id)} className="text-slate hover:text-red-500" title="Delete"><Trash2 size={15} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Landing: choose document type ─────────────────────────────── */}
        {!docType && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="flex justify-center mb-4"><Sparkles size={40} className="text-orange" /></div>
            <h3 className="text-[20px] font-semibold text-carbon mb-2">AI Document Generator</h3>
            <p className="text-[13px] text-slate max-w-md mb-8 leading-relaxed">
              Choose what you want to build. Attach backup files (PDFs, Excels with data, reports)
              and AI extracts the relevant information to fill in the document.
            </p>
            <div className="grid grid-cols-3 gap-4 w-full max-w-2xl">
              {(Object.keys(DOC_TYPE_META) as DocType[]).map(t => (
                <button key={t} onClick={() => chooseDocType(t)}
                  className={`rounded-[12px] border-2 p-6 text-center transition-transform hover:scale-[1.02] ${DOC_TYPE_META[t].color}`}>
                  <div className="flex justify-center mb-3">{DOC_TYPE_META[t].icon(32)}</div>
                  <div className="text-[13px] font-semibold mb-1">{DOC_TYPE_META[t].label}</div>
                  <div className="text-[10px] text-slate leading-relaxed">{DOC_TYPE_META[t].blurb}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setShowLibrary(true)}
              className="mt-8 flex items-center gap-1.5 text-[12px] text-slate hover:text-carbon">
              <FolderOpen size={14} /> Document Library — browse uploaded files
            </button>
          </div>
        )}

        {/* ── Default template not configured yet ──────────────────────── */}
        {docType && docType !== "twopager" && !selected && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <button onClick={backToLanding} className="flex items-center gap-1 text-[12px] text-slate hover:text-carbon mb-6">
              <ChevronLeft size={14} /> Change document type
            </button>
            <div className="flex justify-center mb-4">{DOC_TYPE_META[docType].icon(40)}</div>
            <h3 className="text-[18px] font-semibold text-carbon mb-2">No {DOC_TYPE_META[docType].label} template configured</h3>
            <p className="text-[13px] text-slate max-w-md mb-6 leading-relaxed">
              This document type doesn&apos;t have a fixed template yet. Upload the {DOC_TYPE_META[docType].label.toLowerCase()} file
              that should be used as the base template for every future document of this type.
            </p>
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-6 py-3 bg-orange text-white rounded-[10px] text-[14px] font-medium hover:opacity-85 transition-colors shadow-sm">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <line x1="6.5" y1="1" x2="6.5" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="1" y1="6.5" x2="12" y2="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Upload template
            </button>
          </div>
        )}

        {/* ── Template ready — generation panel ────────────────────────── */}
        {docType && selected && (
          <div className="py-10 px-6 space-y-4 max-w-3xl mx-auto">

            <button onClick={backToLanding} className="flex items-center gap-1 text-[12px] text-slate hover:text-carbon">
              <ChevronLeft size={14} /> Change document type
            </button>

            {/* Header */}
            <div className="flex items-center gap-4">
              <div className="shrink-0"><DocTypeIcon type={selected.type} size={44} /></div>
              <div className="flex-1">
                <h1 className="text-[20px] font-semibold text-carbon">New {DOC_TYPE_META[docType].label} document</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${TYPE_COLOR[selected.type]}`}>{TYPE_LABEL[selected.type]}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-green-600 font-medium"><Sparkles size={11} />AI</span>
                </div>
              </div>
              <button onClick={() => setShowUpload(true)}
                className="text-[11px] font-medium text-slate hover:text-carbon border border-chalk px-3 py-1.5 rounded-[7px] hover:bg-fog transition-colors shrink-0">
                Replace template
              </button>
            </div>

            {/* Step 1 — Company (optional) */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-orange text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                <div>
                  <div className="text-[13px] font-semibold text-carbon">Company <span className="text-[11px] font-normal text-slate">(Optional)</span></div>
                  <div className="text-[10px] text-slate">If selected, AI uses its financial data. You can generate without a company using instructions only.</div>
                </div>
              </div>
              <select value={companyId} onChange={e => setCompanyId(e.target.value)}
                className="w-full border border-chalk rounded-[8px] px-3 py-2.5 text-[13px] text-carbon bg-white focus:outline-none focus:border-carbon">
                <option value="">— No specific company —</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.sector ? ` · ${c.sector}` : ""}{c.stage ? ` · ${c.stage}` : ""}</option>
                ))}
              </select>
              {companyId && (
                <div className="mt-2 text-[10px] text-slate">
                  AI will use the financial data, comparables and metrics for this company from the radar.
                </div>
              )}
            </div>

            {/* Step 2 — Context files */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-orange text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                  <div>
                    <div className="text-[13px] font-semibold text-carbon">Backup files</div>
                    <div className="text-[10px] text-slate">Optional — AI reads them to enrich the document</div>
                  </div>
                </div>
                <button onClick={() => contextFileRef.current?.click()}
                  className="text-[11px] font-medium text-carbon border border-chalk px-3 py-1.5 rounded-[7px] hover:bg-fog transition-colors">
                  + Add
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
                    <div className="flex justify-center mb-1"><Paperclip size={22} className="text-chalk" /></div>
                    <div className="text-[12px] text-slate">Drag or click to add files</div>
                    <div className="text-[10px] text-slate/60 mt-0.5">PDF · Word · Excel · PowerPoint · TXT · Images</div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate">+ Add more files</div>
                )}
              </div>

              {/* File list */}
              {contextFiles.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {contextFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2.5 bg-fog rounded-[8px] px-3 py-2">
                      <span className="shrink-0"><FileTypeIcon name={f.name} size={16} /></span>
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
                    ✓ AI will read {contextFiles.length} file{contextFiles.length > 1 ? "s" : ""} to extract additional information
                  </div>
                </div>
              )}

              {/* API key requirement */}
              {contextFiles.length > 0 && !hasApiKey && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-[8px] p-3">
                  <div className="text-[11px] text-yellow-800 font-medium mb-1">⚠ API key required</div>
                  <div className="text-[10px] text-yellow-700 mb-2">
                    To use backup files with AI, you need to configure your Anthropic API key.
                  </div>
                  <a href="/settings" className="text-[10px] font-semibold text-yellow-700 underline hover:text-yellow-900">
                    Go to Settings →
                  </a>
                </div>
              )}

              {/* What to upload */}
              <div className="mt-3 pt-3 border-t border-chalk">
                <div className="text-[10px] text-slate font-medium mb-1">What can you upload?</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {[
                    ["PDF", "Financial statements, reports"],
                    ["Excel", "Financial models, historical data"],
                    ["PowerPoint", "Previous company decks"],
                    ["Word", "Due diligence, prior memos"],
                    ["Image", "Screenshots, tables, logos"],
                    ["TXT / CSV", "Data exported from systems"],
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
                <span className="w-5 h-5 rounded-full bg-orange text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                <div>
                  <div className="text-[13px] font-semibold text-carbon">AI Instructions <span className="text-[11px] font-normal text-slate">(Optional)</span></div>
                  <div className="text-[10px] text-slate">Specify what you want AI to do with this document</div>
                </div>
              </div>
              <textarea
                value={userPrompt}
                onChange={e => setUserPrompt(e.target.value)}
                rows={4}
                placeholder={"Examples:\n• Adapt this presentation for an edtech company in Brazil. Use the financial data from the attached files.\n• Replace the financial data with the attached Excel and update the year to 2026.\n• Create a generic version without a specific company that serves as a reusable template.\n• Translate to Spanish and adjust the tone for a LATAM fund."}
                className="w-full border border-chalk rounded-[8px] px-3 py-2.5 text-[12px] text-carbon placeholder:text-slate/40 focus:outline-none focus:border-carbon resize-none leading-relaxed"
              />
              {userPrompt.trim() && !hasApiKey && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-[7px] px-2.5 py-1.5">
                  <span>⚠</span>
                  <span>Anthropic API key required for custom instructions. <a href="/settings" className="underline font-medium">Configure →</a></span>
                </div>
              )}
            </div>

            {/* Step 4 — Generate */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-5 h-5 rounded-full bg-orange text-white text-[10px] font-bold flex items-center justify-center shrink-0">4</span>
                <div className="text-[13px] font-semibold text-carbon">Generate document</div>
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
                  Document generated successfully!
                </div>
              )}
              {lastDownload && (
                <div className="mb-4 flex items-center gap-2 text-[12px] text-[#004F46] bg-[#004F46]/5 border border-[#004F46]/20 rounded-[8px] p-3">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  <span className="flex-1">Last generated presentation</span>
                  <a href={lastDownload.url} download={lastDownload.filename} className="font-semibold underline underline-offset-2 hover:text-[#002a24]">
                    Download again
                  </a>
                </div>
              )}
              {qaWarnings.length > 0 && (
                <div className="mb-4 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-[8px] p-3">
                  <div className="font-semibold mb-1">{qaWarnings.length} layout warning{qaWarnings.length !== 1 ? "s" : ""} detected — review these slides:</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {qaWarnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
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
                    Generation may take 30–90 seconds depending on document size
                  </p>
                </div>
              )}

              <button onClick={handleGenerate} disabled={generating || !selected}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-orange text-white rounded-[10px] text-[14px] font-semibold hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {generating ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                    </svg>
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    Generate with AI and Download
                  </>
                )}
              </button>


              {/* Advanced Build button — PPTX only */}
              {selected?.type === "pptx" && !plan && (
                <div className="mt-3 pt-3 border-t border-chalk">
                  <div className="text-[10px] text-slate mb-2 font-medium">Advanced mode — native editable charts in PowerPoint</div>
                  {planErr && (
                    <div className="mb-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-[7px] p-2.5">{planErr}</div>
                  )}
                  <button onClick={() => handlePlan()} disabled={planning || generating || uploadingCtx}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-[#004F46] text-white rounded-[10px] text-[13px] font-semibold hover:bg-[#00403A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {uploadingCtx ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                        </svg>
                        Uploading files…
                      </>
                    ) : planning ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                        </svg>
                        Planning presentation…
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/>
                          <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/>
                          <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor"/>
                          <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/>
                        </svg>
                        Plan presentation with native charts
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-chalk flex items-start gap-2">
                <Lock size={14} className="text-slate shrink-0" />
                <div className="text-[10px] text-slate leading-relaxed">
                  The template is fixed by the firm. Backup files are used only for this generation and are not stored on the server.
                </div>
              </div>
            </div>

            {/* Plan review card */}
            {plan && (
              <div className="bg-white border border-[#004F46]/30 rounded-[12px] overflow-hidden">
                {/* Plan header */}
                <div className="bg-[#004F46] px-5 py-4 flex items-center justify-between">
                  <div>
                    <div className="text-white text-[14px] font-semibold">Presentation Plan</div>
                    <div className="text-[#A5C8D1] text-[11px] mt-0.5">{plan.slides.length} slides · Review and approve before building</div>
                  </div>
                  <button onClick={() => { setPlan(null); setPlanFeedback(""); setBuildErr(null); }}
                    className="text-white/60 hover:text-white p-1 rounded transition-colors">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>

                {/* Deck title */}
                <div className="px-5 py-3 border-b border-chalk bg-[#004F46]/5">
                  <div className="text-[13px] font-semibold text-[#004F46]">{plan.deck_title}</div>
                  {plan.deck_subtitle && <div className="text-[11px] text-slate mt-0.5">{plan.deck_subtitle}</div>}
                </div>

                {/* Slides outline */}
                <div className="px-5 py-4 space-y-1">
                  {plan.slides.map((slide) => {
                    if (slide.type === "cover") {
                      return (
                        <div key={slide.index} className="flex items-start gap-3 py-2">
                          <Target size={16} className="text-orange shrink-0 mt-0.5" />
                          <div>
                            <div className="text-[12px] font-semibold text-carbon">Cover</div>
                            <div className="text-[11px] text-slate">{slide.title}{slide.subtitle ? ` — ${slide.subtitle}` : ""}</div>
                          </div>
                        </div>
                      );
                    }
                    if (slide.type === "back_cover") {
                      return (
                        <div key={slide.index} className="flex items-start gap-3 py-2">
                          <Flag size={16} className="text-graphite shrink-0 mt-0.5" />
                          <div>
                            <div className="text-[12px] font-semibold text-carbon">Back cover</div>
                            {slide.title && <div className="text-[11px] text-slate">{slide.title}</div>}
                          </div>
                        </div>
                      );
                    }
                    if (slide.type === "divider") {
                      return (
                        <div key={slide.index} className="mt-3 mb-1">
                          <div className="flex items-center gap-2">
                            <div className="h-px flex-1 bg-[#004F46]/20"></div>
                            <span className="text-[10px] font-bold text-[#004F46] tracking-wider uppercase">{slide.section || slide.title}</span>
                            <div className="h-px flex-1 bg-[#004F46]/20"></div>
                          </div>
                        </div>
                      );
                    }
                    const slideNumber = plan.slides.filter(s => s.type === "slide" && s.index <= slide.index).length;
                    return (
                      <div key={slide.index} className="flex items-start gap-3 py-2 pl-2">
                        <span className="text-[10px] font-bold text-[#004F46]/60 shrink-0 w-4 mt-0.5">{slideNumber}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-carbon">{slide.title}</div>
                          {slide.chart && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-[9px] font-medium text-[#004F46] bg-[#004F46]/10 rounded px-1.5 py-0.5 shrink-0">chart</span>
                              <span className="text-[11px] text-slate truncate">{slide.chart}</span>
                            </div>
                          )}
                          {slide.takeaway && (
                            <div className="text-[11px] text-graphite mt-1 leading-snug italic">&ldquo;{slide.takeaway}&rdquo;</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Feedback + actions */}
                <div className="px-5 pb-5 pt-3 border-t border-chalk space-y-3">
                  {buildErr && (
                    <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] p-3">{buildErr}</div>
                  )}
                  {planErr && (
                    <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] p-3">{planErr}</div>
                  )}

                  {/* Build progress panel */}
                  {building && buildProgress && (
                    <div className="rounded-[10px] border border-[#004F46]/20 bg-[#004F46]/5 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <svg className="animate-spin w-4 h-4 text-[#004F46] shrink-0" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                          </svg>
                          <span className="text-[12px] font-semibold text-[#004F46] truncate">{buildProgress.message}</span>
                        </div>
                        <button onClick={handleCancelBuild}
                          className="shrink-0 ml-3 text-[11px] text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-[6px] hover:bg-red-50 transition-colors">
                          Cancel
                        </button>
                      </div>
                      {buildProgress.total > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex gap-1">
                            {Array.from({ length: buildProgress.total }).map((_, idx) => (
                              <div key={idx} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                                idx < buildProgress.current
                                  ? "bg-[#004F46]"
                                  : idx === buildProgress.current
                                  ? "bg-[#004F46]/50 animate-pulse"
                                  : "bg-[#004F46]/15"
                              }`} />
                            ))}
                          </div>
                          <div className="text-[10px] text-slate">
                            Step {buildProgress.current} of {buildProgress.total}
                            {buildProgress.total - buildProgress.current > 0
                              ? ` — ${buildProgress.total - buildProgress.current} remaining`
                              : ""}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!building && (
                    <div>
                      <label className="text-[11px] font-medium text-graphite block mb-1.5">Want to adjust the plan?</label>
                      <textarea
                        value={planFeedback}
                        onChange={e => setPlanFeedback(e.target.value)}
                        rows={3}
                        placeholder={"e.g. Add a valuation slide. Remove the financials section and add more detail on the thesis. The overview should be more detailed with client and geography data."}
                        className="w-full border border-chalk rounded-[8px] px-3 py-2 text-[12px] text-carbon placeholder:text-slate/40 focus:outline-none focus:border-[#004F46] resize-none leading-relaxed"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    {!building && (
                      <button onClick={() => handlePlan(planFeedback || undefined)}
                        disabled={planning || building}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-[#004F46] text-[#004F46] rounded-[9px] text-[12px] font-medium hover:bg-[#004F46]/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                        {planning ? (
                          <>
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                            </svg>
                            Refining…
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M1 6a5 5 0 1010 0A5 5 0 001 6z" stroke="currentColor" strokeWidth="1.3"/>
                              <path d="M9 4l2-2M9 4l-1-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                            </svg>
                            Refine plan
                          </>
                        )}
                      </button>
                    )}
                    <button onClick={handleBuildFromPlan}
                      disabled={planning || building}
                      className={`flex items-center justify-center gap-1.5 py-2.5 bg-[#004F46] text-white rounded-[9px] text-[13px] font-semibold hover:bg-[#00403A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${building ? "flex-[3]" : "flex-[2]"}`}>
                      {building ? (
                        <>
                          <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                          </svg>
                          Building…
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/>
                            <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/>
                            <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/>
                          </svg>
                          Approve and build presentation
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── Company 2-Pager flow ─────────────────────────────────────── */}
        {docType === "twopager" && (
          <div className="py-10 px-6 space-y-4 max-w-3xl mx-auto">

            <button onClick={backToLanding} className="flex items-center gap-1 text-[12px] text-slate hover:text-carbon">
              <ChevronLeft size={14} /> Change document type
            </button>

            <div className="flex items-center gap-4">
              <div className="shrink-0"><Flag size={44} className="text-[#004F46]" /></div>
              <div className="flex-1">
                <h1 className="text-[20px] font-semibold text-carbon">New Company 2-Pager</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-[#004F46]/10 text-[#004F46] border-[#004F46]/30">Word</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-green-600 font-medium"><Sparkles size={11} />AI</span>
                </div>
              </div>
            </div>

            {/* Step 1 — Company */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-[#004F46] text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                <div>
                  <div className="text-[13px] font-semibold text-carbon">Company <span className="text-[11px] font-normal text-slate">(Optional)</span></div>
                  <div className="text-[10px] text-slate">If selected, AI uses its financial data.</div>
                </div>
              </div>
              <select value={companyId} onChange={e => setCompanyId(e.target.value)}
                className="w-full border border-chalk rounded-[8px] px-3 py-2.5 text-[13px] text-carbon bg-white focus:outline-none focus:border-carbon">
                <option value="">— No specific company —</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.sector ? ` · ${c.sector}` : ""}{c.stage ? ` · ${c.stage}` : ""}</option>
                ))}
              </select>
            </div>

            {/* Step 2 — Context files */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#004F46] text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                  <div>
                    <div className="text-[13px] font-semibold text-carbon">Backup files</div>
                    <div className="text-[10px] text-slate">Optional — AI reads them to enrich the brief</div>
                  </div>
                </div>
                <button onClick={() => contextFileRef.current?.click()}
                  className="text-[11px] font-medium text-carbon border border-chalk px-3 py-1.5 rounded-[7px] hover:bg-fog transition-colors">
                  + Add
                </button>
              </div>
              <input ref={contextFileRef} type="file" multiple
                accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg"
                className="hidden"
                onChange={e => { if (e.target.files) addContextFiles(e.target.files); e.target.value = ""; }}/>

              <div
                onDragOver={e => { e.preventDefault(); setCtxDragOver(true); }}
                onDragLeave={() => setCtxDragOver(false)}
                onDrop={e => { e.preventDefault(); setCtxDragOver(false); addContextFiles(e.dataTransfer.files); }}
                onClick={() => contextFileRef.current?.click()}
                className={`rounded-[8px] border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
                  ctxDragOver ? "border-[#004F46] bg-fog" : contextFiles.length === 0 ? "border-chalk hover:border-graphite/40 hover:bg-fog/50" : "border-chalk/40"}`}>
                {contextFiles.length === 0 ? (
                  <div>
                    <div className="flex justify-center mb-1"><Paperclip size={22} className="text-chalk" /></div>
                    <div className="text-[12px] text-slate">Drag or click to add files</div>
                    <div className="text-[10px] text-slate/60 mt-0.5">PDF · Word · Excel · PowerPoint · TXT · Images</div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate">+ Add more files</div>
                )}
              </div>

              {contextFiles.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {contextFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2.5 bg-fog rounded-[8px] px-3 py-2">
                      <span className="shrink-0"><FileTypeIcon name={f.name} size={16} /></span>
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
                </div>
              )}

              {contextFiles.length > 0 && !hasApiKey && (
                <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-[8px] p-3">
                  <div className="text-[11px] text-yellow-800 font-medium mb-1">⚠ API key required</div>
                  <a href="/settings" className="text-[10px] font-semibold text-yellow-700 underline hover:text-yellow-900">Go to Settings →</a>
                </div>
              )}
            </div>

            {/* Step 3 — Instructions + length */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-[#004F46] text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                <div>
                  <div className="text-[13px] font-semibold text-carbon">Instructions and length</div>
                  <div className="text-[10px] text-slate">Length is a target, not an exact guarantee</div>
                </div>
              </div>
              <textarea
                value={userPrompt}
                onChange={e => setUserPrompt(e.target.value)}
                rows={3}
                placeholder="Optional — e.g. Emphasize the go-to-market angle. Keep the tone conservative for a lender audience."
                className="w-full border border-chalk rounded-[8px] px-3 py-2.5 text-[12px] text-carbon placeholder:text-slate/40 focus:outline-none focus:border-[#004F46] resize-none leading-relaxed mb-3"
              />
              <label className="block text-[11px] font-medium text-graphite mb-1.5">Length: {pageCount} page{pageCount !== 1 ? "s" : ""}</label>
              <input type="range" min={1} max={10} value={pageCount} onChange={e => setPageCount(Number(e.target.value))}
                className="w-full accent-[#004F46]" />
            </div>

            {/* Step 4 — Section outline */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-[#004F46] text-white text-[10px] font-bold flex items-center justify-center shrink-0">4</span>
                <div>
                  <div className="text-[13px] font-semibold text-carbon">Section outline</div>
                  <div className="text-[10px] text-slate">Starts from the firm default — edit freely for this document only</div>
                </div>
              </div>

              {!tpSectionsLoaded ? (
                <div className="text-center py-6 text-slate text-[12px]">Loading outline...</div>
              ) : (
                <div className="space-y-2">
                  {tpSections.map((s, idx) => (
                    <div key={s.id} className={`border rounded-[8px] p-3 space-y-2 ${s.included ? "border-chalk" : "border-chalk/40 opacity-50"}`}>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={s.included} onChange={e => updateTpSection(idx, { included: e.target.checked })}
                          className="shrink-0 accent-[#004F46]" />
                        <input
                          type="text"
                          value={s.title}
                          onChange={e => updateTpSection(idx, { title: e.target.value })}
                          className="flex-1 px-3 py-1.5 text-[12px] font-medium bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-[#004F46]"
                        />
                        <button onClick={() => moveTpSection(idx, -1)} disabled={idx === 0} className="px-1.5 py-1 text-slate hover:text-carbon disabled:opacity-30 text-[12px]">↑</button>
                        <button onClick={() => moveTpSection(idx, 1)} disabled={idx === tpSections.length - 1} className="px-1.5 py-1 text-slate hover:text-carbon disabled:opacity-30 text-[12px]">↓</button>
                        <button onClick={() => removeTpSection(idx)} className="px-1.5 py-1 text-red-500 hover:text-red-700 text-[12px]">✕</button>
                      </div>
                    </div>
                  ))}
                  <button onClick={addTpSection}
                    className="w-full py-2 border border-dashed border-chalk rounded-[8px] text-[12px] text-slate hover:text-carbon hover:border-graphite/40 transition-colors">
                    + Add Section
                  </button>
                </div>
              )}
            </div>

            {/* Step 5 — Draft */}
            <div className="bg-white border border-chalk rounded-[12px] p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-5 h-5 rounded-full bg-[#004F46] text-white text-[10px] font-bold flex items-center justify-center shrink-0">5</span>
                <div className="text-[13px] font-semibold text-carbon">Draft content</div>
              </div>

              {tpPlanErr && (
                <div className="mb-3 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-[7px] p-2.5">{tpPlanErr}</div>
              )}
              {tpLastDownload && !tpPlan && (
                <div className="mb-3 flex items-center gap-2 text-[12px] text-[#004F46] bg-[#004F46]/5 border border-[#004F46]/20 rounded-[8px] p-3">
                  <span className="flex-1">Last generated 2-pager</span>
                  <a href={tpLastDownload.url} download={tpLastDownload.filename} className="font-semibold underline underline-offset-2 hover:text-[#002a24]">
                    Download again
                  </a>
                </div>
              )}

              <button onClick={() => handleTwoPagerPlan()} disabled={tpPlanning || uploadingCtx || !tpSectionsLoaded}
                className="w-full flex items-center justify-center gap-2 py-3 bg-[#004F46] text-white rounded-[10px] text-[13px] font-semibold hover:bg-[#00403A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {uploadingCtx ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                    </svg>
                    Uploading files…
                  </>
                ) : tpPlanning ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                    </svg>
                    Drafting content…
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    Draft content with AI
                  </>
                )}
              </button>
            </div>

            {/* Review card */}
            {tpPlan && (
              <div className="bg-white border border-[#004F46]/30 rounded-[12px] overflow-hidden">
                <div className="bg-[#004F46] px-5 py-4 flex items-center justify-between">
                  <div>
                    <div className="text-white text-[14px] font-semibold">{tpPlan.title}</div>
                    {tpPlan.subtitle && <div className="text-[#A5C8D1] text-[11px] mt-0.5">{tpPlan.subtitle}</div>}
                  </div>
                  <button onClick={() => { setTpPlan(null); setTpEdits({}); setTpFeedback(""); setTpBuildErr(null); }}
                    className="text-white/60 hover:text-white p-1 rounded transition-colors">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>

                <div className="px-5 py-4 space-y-4 max-h-[420px] overflow-y-auto">
                  {tpPlan.sections.map((s, idx) => (
                    <div key={idx}>
                      <label className="block text-[12px] font-semibold text-[#004F46] mb-1.5">{s.heading}</label>
                      <textarea
                        value={tpEdits[idx] ?? s.paragraphs.join("\n\n")}
                        onChange={e => setTpEdits(prev => ({ ...prev, [idx]: e.target.value }))}
                        rows={Math.max(3, Math.min(10, s.paragraphs.join(" ").length / 90))}
                        className="w-full border border-chalk rounded-[8px] px-3 py-2 text-[12px] text-carbon focus:outline-none focus:border-[#004F46] resize-y leading-relaxed"
                      />
                    </div>
                  ))}
                </div>

                <div className="px-5 pb-5 pt-3 border-t border-chalk space-y-3">
                  {tpBuildErr && (
                    <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] p-3">{tpBuildErr}</div>
                  )}
                  {tpPlanErr && (
                    <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] p-3">{tpPlanErr}</div>
                  )}

                  <div>
                    <label className="text-[11px] font-medium text-graphite block mb-1.5">Want to adjust the draft?</label>
                    <textarea
                      value={tpFeedback}
                      onChange={e => setTpFeedback(e.target.value)}
                      rows={2}
                      placeholder="e.g. Make the financial highlights section more detailed and add the peer comparables."
                      className="w-full border border-chalk rounded-[8px] px-3 py-2 text-[12px] text-carbon placeholder:text-slate/40 focus:outline-none focus:border-[#004F46] resize-none leading-relaxed"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => handleTwoPagerPlan(tpFeedback || undefined)}
                      disabled={tpPlanning || tpBuilding}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-[#004F46] text-[#004F46] rounded-[9px] text-[12px] font-medium hover:bg-[#004F46]/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      {tpPlanning ? "Regenerating…" : "Regenerate"}
                    </button>
                    <button onClick={handleTwoPagerBuild}
                      disabled={tpPlanning || tpBuilding}
                      className="flex-[2] flex items-center justify-center gap-1.5 py-2.5 bg-[#004F46] text-white rounded-[9px] text-[13px] font-semibold hover:bg-[#00403A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      {tpBuilding ? (
                        <>
                          <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                          </svg>
                          Building…
                        </>
                      ) : "Build Word document"}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
