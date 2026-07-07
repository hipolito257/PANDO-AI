import { type ClassValue, clsx } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// Drizzle wraps driver errors in a generic "Failed query: ..." message and
// puts the real Postgres error (e.g. "column ... does not exist") on `.cause`.
export function dbErrorMessage(e: unknown): string {
  const cause = (e as { cause?: unknown })?.cause;
  if (cause instanceof Error) return cause.message;
  if (e instanceof Error) return e.message;
  return "Unknown database error";
}

export function fmt(n: number | null | undefined, opts?: Intl.NumberFormatOptions) {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", opts).format(n);
}

export function fmtM(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}B`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}M`;
  return `$${n.toFixed(0)}K`;
}

export function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
}

export function fmtDateShort(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(new Date(d));
}

export function scoreColor(score: number) {
  if (score >= 85) return "#059669";
  if (score >= 70) return "#d97706";
  return "#828282";
}

export function deltaColor(n: number | null | undefined) {
  if (!n) return "text-slate";
  return n > 0 ? "text-emerald-600" : "text-red-500";
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Claude reaches for em-dashes constantly regardless of prompt wording, and
// generated presentations must never contain one — strips every em-dash out
// of an arbitrary JSON value (plan/slide objects) as a hard guarantee.
export function stripEmDashes(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\s*—\s*/g, ", ").replace(/—/g, "-");
  if (Array.isArray(value)) return value.map(stripEmDashes);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripEmDashes(v);
    return out;
  }
  return value;
}
