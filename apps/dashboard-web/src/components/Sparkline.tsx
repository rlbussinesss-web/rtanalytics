/**
 * Tiny inline-SVG sparkline. Hand-built rather than pulled from a chart lib:
 * one <path>, no dependency, no runtime cost, and it inherits the accent
 * colour so it themes for free.
 */
export function Sparkline({
  data,
  color = "var(--accent)",
  width = 92,
  height = 30,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return <svg className="stat-spark" viewBox={`0 0 ${width} ${height}`} />;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);

  const points = data.map((v, i) => `${i * stepX},${y(v)}`);
  const line = `M${points.join(" L")}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gradId = `spark-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg className="stat-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
