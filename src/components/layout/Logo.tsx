import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  wordmark?: boolean;
  className?: string;
  dark?: boolean;
}

export function Logo({ size = "md", className, dark = false }: LogoProps) {
  const heights = { sm: 36, md: 44, lg: 58 };
  const h = heights[size];
  const w = Math.round(h * 1.28); // matches the 460×360 PNG aspect ratio

  // The PNG has light-gray artwork on white. The feColorMatrix filter:
  //  - converts all pixels to the target RGBA color
  //  - uses the pixel's darkness (1-R) × 10 as the alpha channel,
  //    so white (R=1) → fully transparent, any non-white → fully opaque
  // Result: white background disappears, artwork appears in the target color.
  const [r, g, b] = dark
    ? [0.851, 0.859, 0.831]  // #D9DBD4 cream on dark backgrounds
    : [0,     0.310, 0.275]; // #004F46 PANDO forest green on light backgrounds

  const filterId = dark ? "pando-logo-cream" : "pando-logo-green";

  return (
    <div className={cn("select-none shrink-0", className)} aria-label="PANDO" role="img">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible">
        <defs>
          <filter id={filterId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values={`0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  -10 0 0 0 10`}
            />
          </filter>
        </defs>
        <image
          href="/pando-logo.png"
          x="0" y="0"
          width={w} height={h}
          preserveAspectRatio="xMidYMid meet"
          filter={`url(#${filterId})`}
        />
      </svg>
    </div>
  );
}
