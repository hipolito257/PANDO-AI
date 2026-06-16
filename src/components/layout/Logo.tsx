import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  wordmark?: boolean;
  className?: string;
  dark?: boolean;
}

export function Logo({ size = "md", wordmark = true, className, dark = false }: LogoProps) {
  const dims = { sm: 28, md: 34, lg: 44 };
  const d = dims[size];
  const textSize = size === "sm" ? "text-[15px]" : size === "lg" ? "text-[22px]" : "text-[18px]";

  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      {/* Mark — mountain ridge on dark square */}
      <svg
        width={d}
        height={d}
        viewBox="0 0 34 34"
        fill="none"
        aria-hidden="true"
        style={{ borderRadius: 6, flexShrink: 0 }}
      >
        <rect width="34" height="34" fill="#202020" rx="6" />
        {/* Left peak */}
        <path
          d="M4 24 L9 14 L14 19 L18 11 L24 19 L28 14 L31 24"
          stroke="white"
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Signal dot — orange */}
        <circle cx="28" cy="10" r="2.5" fill="#ff682c" />
      </svg>

      {wordmark && (
        <span
          className={cn(
            "font-poly tracking-tight font-[400]",
            textSize,
            dark ? "text-white" : "text-carbon"
          )}
        >
          PANDO
        </span>
      )}
    </div>
  );
}
