import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Sparkline } from "./Sparkline";

/**
 * Premium metric tile: icon, name, big value, a delta vs the previous period,
 * and a sparkline. Delta and spark are optional so the same component serves
 * both live counters (no history) and historical KPIs.
 */
export function StatCard({
  icon,
  name,
  value,
  delta,
  spark,
  accent = "var(--accent)",
}: {
  icon: ReactNode;
  name: string;
  value: string | number;
  delta?: number | null;
  spark?: number[];
  accent?: string;
}) {
  return (
    <div className="card stat-card">
      <div className="stat-top">
        <span className="stat-ico" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>
          {icon}
        </span>
        <span className="stat-name">{name}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        {delta != null && <Delta value={delta} />}
        {spark && spark.length > 1 && <Sparkline data={spark} color={accent} />}
      </div>
    </div>
  );
}

function Delta({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  if (pct === 0) {
    return (
      <span className="delta flat">
        <Minus /> 0%
      </span>
    );
  }
  const up = pct > 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`}>
      {up ? <ArrowUpRight /> : <ArrowDownRight />}
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}
