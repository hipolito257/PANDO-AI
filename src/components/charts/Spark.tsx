"use client";

interface SparkProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
}

export function Spark({
  values,
  width = 80,
  height = 32,
  color = "#ff682c",
  fill = true,
  strokeWidth = 1.5,
}: SparkProps) {
  if (!values || values.length < 2) return null;

  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const pts = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * w,
    y: pad + h - ((v - min) / range) * h,
  }));

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${(pad + h).toFixed(1)} L ${pad} ${(pad + h).toFixed(1)} Z`;

  const gradId = `sg-${values.length}-${values[0]?.toFixed(0) ?? "0"}-${values[values.length - 1]?.toFixed(0) ?? "0"}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {fill && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={area} fill={`url(#${gradId})`} />}
      <path d={line} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="2" fill={color} />
    </svg>
  );
}
