"use client";

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}

export function Donut({ segments, size = 100, thickness = 18, centerLabel, centerSub }: DonutProps) {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0);

  let cumulative = 0;
  const slices = segments.map((seg) => {
    const frac = seg.value / (total || 1);
    const dash = frac * circ;
    const offset = circ - cumulative * circ;
    cumulative += frac;
    return { ...seg, dash, offset };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      {/* BG track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#efefef" strokeWidth={thickness} />
      {slices.map((s, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={thickness}
          strokeDasharray={`${s.dash.toFixed(2)} ${(circ - s.dash).toFixed(2)}`}
          strokeDashoffset={s.offset.toFixed(2)}
          strokeLinecap="round"
        />
      ))}
      {(centerLabel || centerSub) && (
        <g style={{ transform: "rotate(90deg)", transformOrigin: `${cx}px ${cy}px` }}>
          {centerLabel && (
            <text x={cx} y={cy + (centerSub ? -2 : 4)} textAnchor="middle" fontSize="14" fontWeight="600" fill="#202020" fontFamily="Inter,sans-serif">
              {centerLabel}
            </text>
          )}
          {centerSub && (
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="#828282" fontFamily="Inter,sans-serif">
              {centerSub}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
