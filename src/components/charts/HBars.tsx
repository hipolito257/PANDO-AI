"use client";

interface HBarsItem {
  label: string;
  value: number;
  color?: string;
}

interface HBarsProps {
  items: HBarsItem[];
  height?: number;
  barH?: number;
  gap?: number;
  color?: string;
  showValue?: boolean;
  maxValue?: number;
}

export function HBars({
  items,
  height,
  barH = 8,
  gap = 20,
  color = "#202020",
  showValue = true,
  maxValue,
}: HBarsProps) {
  const max = maxValue ?? Math.max(...items.map((i) => i.value));
  const w = 200;
  const labelW = 80;
  const valW = 36;
  const barW = w - labelW - valW - 8;
  const totalH = height ?? items.length * (barH + gap) - gap + 4;

  return (
    <svg width={w} height={totalH} viewBox={`0 0 ${w} ${totalH}`} style={{ overflow: "visible" }}>
      {items.map((item, i) => {
        const y = i * (barH + gap);
        const bw = max > 0 ? (item.value / max) * barW : 0;
        const c = item.color ?? color;
        return (
          <g key={i}>
            <text x={0} y={y + barH} fontSize="10" fill="#828282" fontFamily="Inter, sans-serif">
              {item.label}
            </text>
            <rect x={labelW} y={y} width={barW} height={barH} rx={barH / 2} fill="#efefef" />
            <rect x={labelW} y={y} width={bw} height={barH} rx={barH / 2} fill={c} />
            {showValue && (
              <text x={labelW + barW + 6} y={y + barH} fontSize="10" fill="#4d4d4d" fontFamily="Inter, sans-serif" fontWeight="500">
                {item.value}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
