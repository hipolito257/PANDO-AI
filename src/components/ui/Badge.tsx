import { cn } from "@/lib/utils";
import { SIGNAL_LABELS, SIGNAL_COLORS, type SignalType } from "@/types";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "orange" | "green" | "red" | "yellow" | "blue" | "carbon";
  size?: "sm" | "md";
  className?: string;
}

export function Badge({ children, variant = "default", size = "sm", className }: BadgeProps) {
  const variantStyles = {
    default: "bg-fog text-graphite border-chalk",
    orange:  "bg-[#fff4f0] text-orange border-[#ffd5c4]",
    green:   "bg-[#f0fdf4] text-emerald-700 border-emerald-200",
    red:     "bg-[#fef2f2] text-red-600 border-red-200",
    yellow:  "bg-[#fffbeb] text-amber-700 border-amber-200",
    blue:    "bg-[#eff6ff] text-blue-700 border-blue-200",
    carbon:  "bg-carbon text-white border-carbon",
  };
  const sizeStyles = { sm: "text-[10px] px-2 py-0.5", md: "text-[12px] px-3 py-1" };

  return (
    <span className={cn(
      "inline-flex items-center gap-1 font-medium border rounded-[20px] whitespace-nowrap",
      variantStyles[variant],
      sizeStyles[size],
      className
    )}>
      {children}
    </span>
  );
}

// Signal-specific badge
interface SignalBadgeProps {
  type: SignalType;
  severity?: string;
  compact?: boolean;
}

export function SignalBadge({ type, severity = "medium", compact = false }: SignalBadgeProps) {
  const color = SIGNAL_COLORS[type] ?? "#828282";
  const label = SIGNAL_LABELS[type] ?? type;
  const dotSize = severity === "high" ? 6 : severity === "medium" ? 5 : 4;

  return (
    <span
      style={{ background: `${color}14`, borderColor: `${color}33`, color }}
      className="inline-flex items-center gap-1.5 text-[10px] font-medium border rounded-[20px] px-2 py-0.5 whitespace-nowrap"
    >
      <span style={{ background: color, width: dotSize, height: dotSize, borderRadius: "50%", display: "inline-block" }} />
      {!compact && label}
    </span>
  );
}

// Status badge
interface StatusBadgeProps { status: string; }
export function StatusBadge({ status }: StatusBadgeProps) {
  const map: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
    monitoring: { label: "Monitoreando", variant: "default" },
    pipeline:   { label: "Pipeline",     variant: "blue" },
    portfolio:  { label: "Portafolio",   variant: "green" },
    discarded:  { label: "Descartado",   variant: "red" },
  };
  const m = map[status] ?? { label: status, variant: "default" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

// Score badge
interface ScoreBadgeProps { score: number; }
export function ScoreBadge({ score }: ScoreBadgeProps) {
  const variant: BadgeProps["variant"] = score >= 85 ? "green" : score >= 70 ? "yellow" : "default";
  return <Badge variant={variant} size="md"><strong>{score}</strong></Badge>;
}
