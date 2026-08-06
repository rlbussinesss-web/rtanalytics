import { useEffect, useRef } from "react";

export interface ClickPoint {
  x: number;
  y: number;
  vw: number;
  rage: boolean;
  dead: boolean;
}

/**
 * Canvas heatmap. Renders click density as additive intensity, then colorizes
 * with a blue→red gradient — the classic technique, hand-rolled so there's no
 * heatmap library and it themes with the app. Coordinates are normalized by
 * each click's viewport width so screens of different sizes overlay correctly.
 */
export function Heatmap({
  points,
  filter,
  width = 880,
}: {
  points: ClickPoint[];
  filter: "all" | "rage" | "dead";
  width?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const shown = points.filter((p) => (filter === "all" ? true : filter === "rage" ? p.rage : p.dead));
    const scaled = shown.map((p) => ({ x: (p.x / p.vw) * width, y: p.y }));
    const maxY = Math.min(6000, Math.max(320, ...scaled.map((p) => p.y + 40)));

    canvas.width = width;
    canvas.height = maxY;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, maxY);

    // 1) additive intensity in grayscale alpha
    const radius = 26;
    for (const p of scaled) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      g.addColorStop(0, "rgba(0,0,0,0.14)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2) colorize by alpha
    const img = ctx.getImageData(0, 0, width, maxY);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]!;
      if (a === 0) continue;
      const t = Math.min(1, a / 200);
      const [r, gc, b] = ramp(t);
      d[i] = r;
      d[i + 1] = gc;
      d[i + 2] = b;
      d[i + 3] = Math.min(220, a * 3);
    }
    ctx.putImageData(img, 0, 0);
  }, [points, filter, width]);

  return <canvas ref={canvasRef} className="heatmap-canvas" />;
}

/** Blue → cyan → green → yellow → red ramp for intensity t in [0,1]. */
function ramp(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0.0, [30, 60, 180]],
    [0.35, [0, 200, 200]],
    [0.55, [0, 210, 90]],
    [0.75, [240, 220, 40]],
    [1.0, [240, 60, 50]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i]![0]) {
      const [t0, c0] = stops[i - 1]!;
      const [t1, c1] = stops[i]!;
      const f = (t - t0) / (t1 - t0 || 1);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1]![1];
}
