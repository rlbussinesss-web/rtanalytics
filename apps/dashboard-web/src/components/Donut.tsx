import { useState } from "react";

/**
 * Donut chart with an interactive legend. Hand-built in SVG: segments are
 * stroke-dasharray arcs on a single circle, which keeps it a few elements and
 * lets segments highlight on hover without a chart library.
 */
export interface Slice {
  label: string;
  value: number;
}

const PALETTE = ["#6366f1", "#8b5cf6", "#ec4899", "#06b6d4", "#10b981", "#f59e0b", "#64748b"];

export function Donut({ data, format }: { data: Slice[]; format?: (l: string) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  const R = 60;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const segments = data.map((d, i) => {
    const frac = d.value / total;
    const seg = {
      color: PALETTE[i % PALETTE.length]!,
      dash: frac * C,
      gap: C - frac * C,
      rot: (offset / total) * 360 - 90,
      i,
    };
    offset += d.value;
    return seg;
  });

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" className="donut-svg">
        <g transform="translate(80,80)">
          {segments.map((s) => (
            <circle
              key={s.i}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={active === s.i ? 22 : 18}
              strokeDasharray={`${s.dash} ${s.gap}`}
              transform={`rotate(${s.rot})`}
              style={{ transition: "stroke-width 0.15s", opacity: active === null || active === s.i ? 1 : 0.35 }}
              onMouseEnter={() => setActive(s.i)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
          <text textAnchor="middle" dy="-2" style={{ fill: "var(--text)", fontSize: 22, fontWeight: 680 }}>
            {active != null ? Math.round((data[active]!.value / total) * 100) + "%" : total}
          </text>
          <text textAnchor="middle" dy="16" style={{ fill: "var(--text-faint)", fontSize: 9 }}>
            {active != null ? (format ? format(data[active]!.label) : data[active]!.label) : "sessões"}
          </text>
        </g>
      </svg>
      <div className="donut-legend">
        {data.map((d, i) => (
          <div
            key={d.label}
            className="donut-leg-row"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            style={{ opacity: active === null || active === i ? 1 : 0.5 }}
          >
            <span className="donut-swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="donut-leg-label">{format ? format(d.label) : d.label}</span>
            <span className="donut-leg-val">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
