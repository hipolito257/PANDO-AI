import { cn } from "@/lib/utils";
import Image from "next/image";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  wordmark?: boolean;
  className?: string;
  dark?: boolean;
}

export function Logo({ size = "md", className }: LogoProps) {
  const heights = { sm: 36, md: 44, lg: 58 };
  const h = heights[size];
  const w = Math.round(h * 1.28);

  return (
    <div className={cn("select-none shrink-0", className)}>
      <Image
        src="/pando-logo.png"
        alt="PANDO"
        width={w}
        height={h}
        style={{ objectFit: "contain" }}
        priority
      />
    </div>
  );
}
