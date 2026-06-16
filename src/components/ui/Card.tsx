import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
}

export function Card({ children, className, padding = "md" }: CardProps) {
  const pads = { none: "", sm: "p-4", md: "p-5", lg: "p-6" };
  return (
    <div className={cn("bg-paper rounded-card shadow-card", pads[padding], className)}>
      {children}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: number;
  sub?: string;
  icon?: React.ReactNode;
  accent?: boolean;
}

export function KpiCard({ label, value, delta, sub, icon, accent }: KpiCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", accent && "border-t-2 border-orange")}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-slate uppercase tracking-wide font-medium mb-1">{label}</p>
          <p className="text-[26px] font-semibold text-carbon tracking-tight font-poly leading-none">{value}</p>
          {delta != null && (
            <p className={cn("text-[11px] mt-1 font-medium", delta >= 0 ? "text-emerald-600" : "text-red-500")}>
              {delta >= 0 ? "+" : ""}{delta}% vs. mes anterior
            </p>
          )}
          {sub && <p className="text-[11px] text-slate mt-0.5">{sub}</p>}
        </div>
        {icon && <div className="text-slate opacity-40">{icon}</div>}
      </div>
    </Card>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, subtitle, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-4", className)}>
      <div>
        <h2 className="text-[14px] font-semibold text-carbon tracking-tight">{title}</h2>
        {subtitle && <p className="text-[11px] text-slate mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
