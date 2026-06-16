"use client";

interface RadarChartProps {
  axes: string[];
  values: number[];   // 0-100
  compare?: number[]; // optional second dataset
  size?: number;
  color?: string;
  compareColor?: string;
}

export function RadarChart({
  axes,
  values,
  compare,
  size = 140,
  color = "#202020",
  compareColor = "#ff682c",
}: RadarChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 20;
  const n = axes.length;

  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, val: number) => {
    const a = angle(i);
    const d = (val / 100) * r;
    return { x: cx + d * Math.cos(a), y: cy + d * Math.sin(a) };
  };

  const webPoly = (vals: number[]) =>
    vals.map((v, i) => { const p = pt(i, v); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(" ");

  // Grid rings
  const rings = [25, 50, 75, 100];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid rings */}
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={Array.from({ length: n }, (_, i) => {
            const p = pt(i, ring);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          }).join(" ")}
          fill="none"
          stroke="#e8e8e8"
          strokeWidth={ring === 100 ? 1.5 : 0.8}
        />
      ))}
      {/* Axis lines */}
      {axes.map((_, i) => {
        const outer = pt(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={outer.x.toFixed(1)} y2={outer.y.toFixed(1)} stroke="#e8e8e8" strokeWidth="0.8" />;
      })}
      {/* Compare area */}
      {compare && (
        <polygon
          points={webPoly(compare)}
          fill={compareColor}
          fillOpacity="0.08"
          stroke={compareColor}
          strokeWidth="1"
          strokeOpacity="0.6"
        />
      )}
      {/* Main area */}
      <polygon
        points={webPoly(values)}
        fill={color}
        fillOpacity="0.1"
        stroke={color}
        strokeWidth="1.5"
      />
      {/* Dots */}
      {values.map((v, i) => {
        const p = pt(i, v);
        return <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} />;
      })}
      {/* Labels */}
      {axes.map((label, i) => {
        const a = angle(i);
        const lx = cx + (r + 14) * Math.cos(a);
        const ly = cy + (r + 14) * Math.sin(a);
        return (
          <text key={i} x={lx.toFixed(1)} y={ly.toFixed(1)} textAnchor="middle" dominantBaseline="middle"
            fontSize="8" fill="#828282" fontFamily="Inter,sans-serif">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
