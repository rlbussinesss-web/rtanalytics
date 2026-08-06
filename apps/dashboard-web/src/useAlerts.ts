import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "./useLiveEvents";

/**
 * Real-time alerts driven by the live event stream — no backend needed. Rules
 * are evaluated as events arrive and fire an in-app toast plus (if granted) a
 * browser notification. Rules and enabled-state persist per browser.
 *
 * Better than a polled/threshold-only alert system: these fire the instant the
 * signal appears in the live feed, with no delay.
 */

export interface AlertRule {
  id: string;
  label: string;
  enabled: boolean;
}

export interface FiredAlert {
  id: string;
  ruleId: string;
  message: string;
  at: number;
  tone: "info" | "warn" | "bad";
}

const DEFAULT_RULES: AlertRule[] = [
  { id: "error", label: "Erro de JavaScript", enabled: true },
  { id: "conversion", label: "Conversão", enabled: true },
  { id: "rage", label: "Rage click", enabled: true },
  { id: "spike", label: "Pico de visitantes online (>10)", enabled: true },
];

const RULES_KEY = "rtanalytics_alert_rules";

function loadRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as AlertRule[];
      // Merge with defaults so newly-added rules appear.
      return DEFAULT_RULES.map((d) => saved.find((s) => s.id === d.id) ?? d);
    }
  } catch { /* ignore */ }
  return DEFAULT_RULES;
}

export function useAlerts(events: LiveEvent[], onlineCount: number) {
  const [rules, setRules] = useState<AlertRule[]>(loadRules);
  const [fired, setFired] = useState<FiredAlert[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const spikeArmed = useRef(true);

  useEffect(() => {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  }, [rules]);

  const isOn = (id: string) => rules.find((r) => r.id === id)?.enabled ?? false;

  const push = (ruleId: string, message: string, tone: FiredAlert["tone"]) => {
    const alert: FiredAlert = { id: `${ruleId}-${Date.now()}-${Math.random()}`, ruleId, message, at: Date.now(), tone };
    setFired((prev) => [alert, ...prev].slice(0, 30));
    if (Notification?.permission === "granted") {
      try { new Notification("RTAnalytics", { body: message }); } catch { /* ignore */ }
    }
  };

  // Event-driven rules.
  useEffect(() => {
    const latest = events[0];
    if (!latest || seen.current.has(latest.eventId)) return;
    seen.current.add(latest.eventId);
    if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-200));

    if (latest.eventType === "error" && isOn("error")) {
      push("error", `Erro de JS na página ${latest.path}`, "bad");
    } else if (latest.eventType === "conversion" && isOn("conversion")) {
      const name = (latest.payload?.name as string) ?? "conversão";
      push("conversion", `Conversão registrada: ${name}`, "info");
    } else if (latest.eventType === "click" && (latest.payload?.rage as boolean) && isOn("rage")) {
      push("rage", `Rage click em ${latest.path}`, "warn");
    }
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  // Threshold rule with hysteresis so it fires once per crossing.
  useEffect(() => {
    if (!isOn("spike")) return;
    if (onlineCount > 10 && spikeArmed.current) {
      spikeArmed.current = false;
      push("spike", `Pico de tráfego: ${onlineCount} visitantes online`, "warn");
    } else if (onlineCount <= 8) {
      spikeArmed.current = true;
    }
  }, [onlineCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRule = (id: string) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));

  const requestPermission = () => {
    if (Notification && Notification.permission === "default") void Notification.requestPermission();
  };

  const dismiss = (id: string) => setFired((prev) => prev.filter((a) => a.id !== id));

  return { rules, toggleRule, fired, dismiss, requestPermission };
}
