"use client";

interface VBarsProps {
  labels: string[];
  values: number[];
  line?: number[];
  width?: number;
  height?: number;
  color?: string;
  lineColor?: string;
}

export function VBars({
  labels,
  values,
  line,
  width = 280,
  height = 120,
  color = "#202020",
  lineColor = "#ff682c",
}: VBarsProps) {
  const padL = 4, padR = 4, padT = 8, padB = 24;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const max = Math.max(...values, ...(line ?? []));
  const n = values.length;
  const groupW = chartW / n;
  const barW = Math.max(groupW * 0.55, 4);

  const bx = (i: number) => padL + i * groupW + groupW / 2;
  const vy = (v: number) => padT + chartH - (v / (max || 1)) * chartH;

  const gradId = `vb-${labels.length}-${values[0]?.toFixed(0) ?? "0"}`;

  // Line path
  let linePath = "";
  if (line) {
    linePath = line.map((v, i) => `${i === 0 ? "M" : "L"} ${bx(i).toFixed(1)} ${vy(v).toFixed(1)}`).join(" ");
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.9" />
          <stop offset="100%" stopColor={color} stopOpacity="0.5" />
        </linearGradient>
      </defs>
      {/* Baseline */}
      <line x1={padL} y1={padT + chartH} x2={width - padR} y2={padT + chartH} stroke="#e8e8e8" strokeWidth="1" />
      {/* Bars */}
      {values.map((v, i) => {
        const bh = (v / (max || 1)) * chartH;
        return (
          <rect
            key={i}
            x={bx(i) - barW / 2}
            y={padT + chartH - bh}
            width={barW}
            height={bh}
            rx="2"
            fill={`url(#${gradId})`}
          />
        );
      })}
      {/* Line overlay */}
      {line && linePath && (
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* X labels */}
      {labels.map((l, i) => (
        <text key={i} x={bx(i)} y={height - 4} textAnchor="middle" fontSize="9" fill="#828282" fontFamily="Inter, sans-serif">
          {l}
        </text>
      ))}
    </svg>
  );
}
