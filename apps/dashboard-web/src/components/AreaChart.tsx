import { useState } from "react";

/**
 * Hand-built area chart with gradient fill, gridlines, hover crosshair and a
 * rich tooltip. Built in raw SVG on purpose: it carries its own identity
 * (nothing about it reads as a default chart library) and costs no bundle
 * weight or extra render work.
 */
export interface Point {
  label: string;
  value: number;
}

export function AreaChart({ data, height = 200 }: { data: Point[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length < 2) {
    return <p className="empty">Sem dados suficientes no período.</p>;
  }

  const W = 800;
  const H = height;
  const padY = 16;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = W / (data.length - 1);
  const y = (v: number) => padY + (1 - v / max) * (H - padY * 2);
  const pts = data.map((d, i) => [i * stepX, y(d.value)] as const);

  const line = `M${pts.map(([x, yy]) => `${x},${yy}`).join(" L")}`;
  const area = `${line} L${W},${H} L0,${H} Z`;
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => padY + f * (H - padY * 2));

  return (
    <div style={{ position: "relative" }}>
      <svg
        className="area-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * W;
          setHover(Math.max(0, Math.min(data.length - 1, Math.round(rel / stepX))));
        }}
      >
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridYs.map((gy, i) => (
          <line key={i} className="grid-line" x1={0} x2={W} y1={gy} y2={gy} />
        ))}
        <path className="area-fill" d={area} />
        <path className="area-stroke" d={line} />
        {hover != null && (
          <>
            <line className="grid-line" x1={pts[hover]![0]} x2={pts[hover]![0]} y1={0} y2={H} style={{ stroke: "var(--border-strong)" }} />
            <circle className="area-dot" cx={pts[hover]![0]} cy={pts[hover]![1]} r={4} />
          </>
        )}
      </svg>
      {hover != null && (
        <Tooltip
          xPct={(hover / (data.length - 1)) * 100}
          point={data[hover]!}
        />
      )}
    </div>
  );
}

function Tooltip({ xPct, point }: { xPct: number; point: Point }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${xPct}%`,
        top: -6,
        transform: "translate(-50%, -100%)",
        background: "var(--surface-3)",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        padding: "7px 10px",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        boxShadow: "var(--shadow)",
        zIndex: 2,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
        {new Date(point.label).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
      </div>
      <div style={{ fontSize: 15, fontWeight: 680, fontVariantNumeric: "tabular-nums" }}>
        {point.value} <span style={{ fontSize: 11, fontWeight: 450, color: "var(--text-muted)" }}>visitantes</span>
      </div>
    </div>
  );
}
