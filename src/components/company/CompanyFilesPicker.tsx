"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type FileRow = { id: string; filename: string; ext: string; createdAt: string | null };

// Lets a generator page choose which files from the company's profile the AI
// should read. Defaults to the 3 newest (the same default the API applies).
export function CompanyFilesPicker({ companyId, value, onChange }: {
  companyId: string;
  value: string[] | null;
  onChange: (ids: string[]) => void;
}) {
  const [files, setFiles] = useState<FileRow[] | null>(null);

  useEffect(() => {
    if (!companyId) { setFiles(null); return; }
    let cancelled = false;
    setFiles(null);
    fetch(`/api/companies/${companyId}/files`)
      .then(r => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((rows: FileRow[]) => {
        if (cancelled) return;
        setFiles(rows);
        const known = new Set(rows.map(r => r.id));
        if (value === null || !value.every(id => known.has(id))) onChange(rows.slice(0, 3).map(r => r.id));
      });
    return () => { cancelled = true; };
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!companyId || files === null) return null;

  if (files.length === 0) {
    return (
      <p className="mt-2 text-[10px] text-slate">
        No files on this company&apos;s profile yet. <Link href={`/empresa/${companyId}`} className="underline hover:text-carbon">Upload its deck or model there</Link> and it will be used here automatically.
      </p>
    );
  }

  const selected = new Set(value ?? []);
  const toggle = (id: string) => onChange(files.filter(f => (f.id === id ? !selected.has(id) : selected.has(f.id))).map(f => f.id));

  return (
    <div className="mt-3 rounded-[8px] bg-fog px-3 py-2.5">
      <p className="text-[11px] font-medium text-carbon mb-1.5">Use files from this company&apos;s profile</p>
      <div className="space-y-1">
        {files.map(f => (
          <label key={f.id} className="flex items-center gap-2 text-[12px] text-carbon cursor-pointer">
            <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
            <span className="text-[9px] font-bold uppercase text-slate w-8">{f.ext}</span>
            <span className="truncate">{f.filename}</span>
          </label>
        ))}
      </div>
      <p className="text-[10px] text-slate mt-1.5">The AI reads the full content of the checked files. A long deck adds roughly US$0.30–0.60 per generation.</p>
    </div>
  );
}
