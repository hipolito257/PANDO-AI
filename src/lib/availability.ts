// Shared by the /equipo page and /api/team/availability.

export const AVAILABILITY_LEVELS = [
  { value: "available",   label: "Available",   hint: "Can take on a new project",    dot: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" },
  { value: "partial",     label: "Partial",     hint: "Can help with something scoped", dot: "#eab308", bg: "#fefce8", border: "#fde68a", text: "#a16207" },
  { value: "nearly_full", label: "Nearly full", hint: "Urgent requests only",          dot: "#f97316", bg: "#fff7ed", border: "#fed7aa", text: "#c2410c" },
  { value: "full",        label: "No capacity", hint: "Fully booked",                  dot: "#dc2626", bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" },
  { value: "away",        label: "Away",        hint: "Vacation or leave",             dot: "#9ca3af", bg: "#f9fafb", border: "#e5e7eb", text: "#4b5563" },
] as const;

export type AvailabilityLevel = (typeof AVAILABILITY_LEVELS)[number]["value"];

export const AVAILABILITY_VALUES = AVAILABILITY_LEVELS.map(l => l.value) as readonly string[];

export function levelInfo(value: string | null | undefined) {
  return AVAILABILITY_LEVELS.find(l => l.value === value);
}

// An update older than this is shown as stale.
export const STALE_AFTER_DAYS = 7;
