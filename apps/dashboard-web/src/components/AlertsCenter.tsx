import { useState } from "react";
import { AlertTriangle, Bell, Check, X } from "lucide-react";
import type { AlertRule, FiredAlert } from "../useAlerts";

/**
 * Alerts UI: a bell in the topbar opens a popover with the live alert feed and
 * per-rule toggles. Toasts (rendered separately) handle the momentary
 * notification; this is the persistent center.
 */
export function AlertsBell({
  fired,
  rules,
  onToggleRule,
  onRequestPermission,
  onDismiss,
}: {
  fired: FiredAlert[];
  rules: AlertRule[];
  onToggleRule: (id: string) => void;
  onRequestPermission: () => void;
  onDismiss: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const unseen = fired.length;

  return (
    <div style={{ position: "relative" }}>
      <button className="icon-btn" title="Alertas" onClick={() => { setOpen((o) => !o); onRequestPermission(); }}>
        <Bell size={16} />
        {unseen > 0 && <span className="badge-dot" />}
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="popover">
            <div className="popover-head">
              <b>Alertas</b>
              <span className="section-count">{fired.length}</span>
            </div>

            <div className="popover-section">Regras</div>
            {rules.map((r) => (
              <button key={r.id} className="rule-row" onClick={() => onToggleRule(r.id)}>
                <span className={`rule-check${r.enabled ? " on" : ""}`}>{r.enabled && <Check size={11} />}</span>
                {r.label}
              </button>
            ))}

            <div className="popover-section">Recentes</div>
            {fired.length === 0 && <div className="empty" style={{ padding: "14px" }}>Nenhum alerta ainda.</div>}
            {fired.slice(0, 12).map((a) => (
              <div key={a.id} className={`alert-item ${a.tone}`}>
                <AlertTriangle size={14} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="alert-msg">{a.message}</div>
                  <div className="alert-time">{new Date(a.at).toLocaleTimeString()}</div>
                </div>
                <button className="alert-x" onClick={() => onDismiss(a.id)}><X size={12} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Transient toasts for the newest alerts. */
export function AlertToasts({ fired, onDismiss }: { fired: FiredAlert[]; onDismiss: (id: string) => void }) {
  const recent = fired.filter((a) => Date.now() - a.at < 6000).slice(0, 3);
  return (
    <div className="toast-stack">
      {recent.map((a) => (
        <div key={a.id} className={`toast ${a.tone}`} onClick={() => onDismiss(a.id)}>
          <AlertTriangle size={15} />
          {a.message}
        </div>
      ))}
    </div>
  );
}
