import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "fill" | "outline" | "ghost" | "orange";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  children,
  variant = "fill",
  size = "md",
  loading,
  icon,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const base = "inline-flex items-center gap-2 font-medium rounded-btn transition-opacity cursor-pointer border select-none";
  const variants = {
    fill:    "bg-carbon text-white border-carbon hover:opacity-85",
    outline: "bg-transparent text-carbon border-carbon hover:bg-fog",
    ghost:   "bg-transparent text-graphite border-transparent hover:bg-fog hover:text-carbon",
    orange:  "bg-orange text-white border-orange hover:opacity-85",
  };
  const sizes = {
    sm: "text-[12px] px-3 py-1.5",
    md: "text-[13px] px-4 py-2",
    lg: "text-[14px] px-5 py-2.5",
  };

  return (
    <button
      className={cn(base, variants[variant], sizes[size], (disabled || loading) && "opacity-50 cursor-not-allowed", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="15 7" />
        </svg>
      ) : icon}
      {children}
    </button>
  );
}
