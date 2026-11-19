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
  // Website buttons: square, thin border, small-caps Josefin with wide tracking.
  const base = "inline-flex items-center justify-center gap-2 font-display uppercase tracking-[.16em] rounded-btn transition-colors duration-300 cursor-pointer border select-none whitespace-nowrap";
  const variants = {
    fill:    "bg-olive text-white border-olive hover:bg-pistacho hover:text-olive hover:border-pistacho",
    outline: "bg-transparent text-olive border-olive/70 hover:bg-olive hover:text-white",
    ghost:   "bg-transparent text-graphite border-transparent hover:bg-fog hover:text-carbon",
    orange:  "bg-olive text-white border-olive hover:bg-pistacho hover:text-olive hover:border-pistacho",
  };
  const sizes = {
    sm: "text-[10.5px] px-3.5 pt-[7px] pb-[5px]",
    md: "text-[11.5px] px-5 pt-[9px] pb-[7px]",
    lg: "text-[12.5px] px-6 pt-[11px] pb-[9px]",
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
