import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  wordmark?: boolean;
  className?: string;
  dark?: boolean;
}

export function Logo({ size = "md", className, dark = false }: LogoProps) {
  const heights = { sm: 32, md: 38, lg: 50 };
  const h = heights[size];
  const w = Math.round(h * 1.6);

  const fg = dark ? "#D9DBD4" : "#004F46";
  const bg = dark ? "#004F46" : "#FFFFFF";

  return (
    <div className={cn("select-none shrink-0", className)}>
      <svg
        width={w}
        height={h}
        viewBox="0 0 160 100"
        fill="none"
        aria-label="PANDO"
      >
        {/* Background */}
        <rect width="160" height="100" fill={bg} rx="3"/>
        {/* Outer border */}
        <rect x="3" y="3" width="154" height="94" rx="2" stroke={fg} strokeWidth="2.5" fill="none"/>
        {/* Horizontal divider */}
        <line x1="3" y1="50" x2="157" y2="50" stroke={fg} strokeWidth="2"/>
        {/* PANDO wordmark in top half */}
        <text
          x="80" y="35"
          textAnchor="middle"
          fontFamily="Work Sans, ui-sans-serif, sans-serif"
          fontSize="20"
          fontWeight="300"
          letterSpacing="8"
          fill={fg}
        >
          PANDO
        </text>
        {/* Left mountain slope */}
        <path d="M10 97 C22 84 42 66 58 57 C68 52 74 50 80 50"
          stroke={fg} strokeWidth="2" fill="none" strokeLinecap="round"/>
        {/* Right mountain slope (mirror) */}
        <path d="M150 97 C138 84 118 66 102 57 C92 52 86 50 80 50"
          stroke={fg} strokeWidth="2" fill="none" strokeLinecap="round"/>
        {/* Central trunk */}
        <line x1="80" y1="97" x2="80" y2="50" stroke={fg} strokeWidth="2" strokeLinecap="round"/>
        {/* Upper root curves */}
        <path d="M80 72 C62 70 42 78 10 97"
          stroke={fg} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
        <path d="M80 72 C98 70 118 78 150 97"
          stroke={fg} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
        {/* Lower root curves */}
        <path d="M80 83 C56 81 36 89 10 97"
          stroke={fg} strokeWidth="0.9" fill="none" strokeLinecap="round"/>
        <path d="M80 83 C104 81 124 89 150 97"
          stroke={fg} strokeWidth="0.9" fill="none" strokeLinecap="round"/>
      </svg>
    </div>
  );
}
