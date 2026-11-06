// Labels and small pieces for showing where a company data point came from.
// Safe on the server and the client (no hooks).
import { fmtM, fmtPct } from "@/lib/utils";

export type FieldChangeRow = {
  id: string; field: string; oldValue: string | null; newValue: string | null;
  sourceType: string; sourceRef: string | null; sourceLabel: string | null; note: string | null;
  userId: string | null; userName: string | null; createdAt: string;
};

const FIELD_LABEL: Record<string, string> = {
  name: "Name", sector: "Sector", subsector: "Subsector", country: "Country", city: "City", stage: "Stage",
  website: "Website", linkedinUrl: "LinkedIn", description: "Description",
  revenueUsd: "Revenue", revenueGrowth: "Revenue growth", ebitdaUsd: "EBITDA", ebitdaMargin: "EBITDA margin",
  employees: "Employees", employeeGrowth: "Employee growth", totalFunding: "Total funding",
  lastFundingAmt: "Last round", lastFundingDate: "Last round date", fundingStage: "Funding stage", status: "Status",
  founder: "Founder added",
};
const MONEY = new Set(["revenueUsd", "ebitdaUsd", "totalFunding", "lastFundingAmt"]);
const PCT = new Set(["revenueGrowth", "employeeGrowth"]);

export const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual edit", document: "Document", ai_web: "AI web research", radar: "Radar", import: "Import",
};
export const SOURCE_COLOR: Record<string, string> = {
  manual: "bg-fog text-graphite", document: "bg-emerald-50 text-emerald-700", ai_web: "bg-violet-50 text-violet-700",
  radar: "bg-amber-50 text-amber-700", import: "bg-sky-50 text-sky-700",
};

// "fin:2024:revenueUsd" → { year: 2024, metric: "revenueUsd" }
function splitFin(field: string) {
  const m = /^fin:(\d{4}):(\w+)$/.exec(field);
  return m ? { year: Number(m[1]), metric: m[2] } : null;
}

export function fieldLabel(field: string) {
  const fin = splitFin(field);
  if (fin) return `${FIELD_LABEL[fin.metric] ?? fin.metric} ${fin.year}`;
  return FIELD_LABEL[field] ?? field;
}

export function fmtValue(field: string, v: string | null) {
  if (v === null || v === "") return "—";
  const metric = splitFin(field)?.metric ?? field;
  const n = Number(v);
  if (Number.isFinite(n)) {
    if (MONEY.has(metric)) return fmtM(n);
    if (PCT.has(metric)) return fmtPct(n);
    if (metric === "ebitdaMargin") return `${n.toFixed(1)}%`;
    if (metric === "employees") return n.toLocaleString("en-US");
  }
  return v.length > 140 ? `${v.slice(0, 140)}…` : v;
}

export function fmtWhen(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function sourceText(c: Pick<FieldChangeRow, "sourceType" | "sourceLabel">) {
  const type = SOURCE_LABEL[c.sourceType] ?? c.sourceType;
  if (!c.sourceLabel || c.sourceLabel === type) return type;
  return c.sourceType === "document" ? c.sourceLabel : `${type} · ${c.sourceLabel}`;
}

// Hover card for a KPI: shows where the current value came from.
export function SourceTip({ change, children }: { change?: FieldChangeRow | null; children: React.ReactNode }) {
  return (
    <div className="relative group">
      {children}
      <div className="pointer-events-none absolute z-30 left-1/2 -translate-x-1/2 top-full mt-1.5 w-[240px] max-w-[80vw] rounded-[8px] bg-carbon text-white text-left p-2.5 shadow-lg hidden group-hover:block">
        {change ? (
          <>
            <p className="text-[9px] uppercase tracking-wide text-white/60">Source</p>
            <p className="text-[11px] font-medium leading-snug">{sourceText(change)}</p>
            {change.note && <p className="text-[10px] text-white/70 mt-1 italic leading-snug line-clamp-3">&ldquo;{change.note}&rdquo;</p>}
            <p className="text-[10px] text-white/60 mt-1">
              {change.userName ? `${change.userName} · ` : ""}{fmtWhen(change.createdAt)}
              {change.oldValue !== null ? ` · was ${fmtValue(change.field, change.oldValue)}` : ""}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-white/70">No recorded source yet. Edits and documents applied from now on are tracked.</p>
        )}
      </div>
    </div>
  );
}
