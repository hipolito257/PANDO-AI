// ── Core domain types ──────────────────────────────────────────────────────

export type CompanyStatus = "monitoring" | "pipeline" | "portfolio" | "discarded";
export type CompanyStage = "seed" | "series-a" | "series-b" | "growth" | "mature";
export type SignalSeverity = "low" | "medium" | "high";
export type SignalType =
  | "funding_due"
  | "exec_change"
  | "competitor_acquired"
  | "hiring_surge"
  | "revenue_inflection"
  | "regulatory_change"
  | "exit_rumor"
  | "exit_signal"
  | "strategic_buyer_interest";

export type MandateTier = "strong" | "candidate" | "weak";
export type UserRole = "admin" | "analyst" | "viewer";
export type DataCategory = "financial" | "news" | "registry" | "intelligence" | "alternative";

// ── UI helpers ──────────────────────────────────────────────────────────────

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  badge?: number;
};

export type KPI = {
  label: string;
  value: string | number;
  delta?: number;   // % change
  deltaLabel?: string;
};

// ── Signal label map ────────────────────────────────────────────────────────

export const SIGNAL_LABELS: Record<SignalType, string> = {
  funding_due: "Funding Round",
  exec_change: "Executive Change",
  competitor_acquired: "Competitor Acquired",
  hiring_surge: "Hiring Surge",
  revenue_inflection: "Revenue Inflection",
  regulatory_change: "Regulatory Change",
  exit_rumor: "Exit Rumor",
  exit_signal: "⚠️ Exit Signal — Confirm",
  strategic_buyer_interest: "Strategic Buyer Interest",
};

export const SIGNAL_COLORS: Record<SignalType, string> = {
  funding_due: "#7c3aed",
  exec_change: "#d97706",
  competitor_acquired: "#dc2626",
  hiring_surge: "#059669",
  revenue_inflection: "#ff682c",
  regulatory_change: "#0369a1",
  exit_rumor: "#db2777",
  exit_signal: "#059669",
  strategic_buyer_interest: "#0891b2",
};

export const STAGE_LABELS: Record<string, string> = {
  seed: "Seed",
  "series-a": "Serie A",
  "series-b": "Serie B",
  growth: "Growth",
  mature: "Maduro",
};

export const STATUS_LABELS: Record<CompanyStatus, string> = {
  monitoring: "Monitoreando",
  pipeline: "Pipeline",
  portfolio: "Portafolio",
  discarded: "Descartado",
};
