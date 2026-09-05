/**
 * Always-on behavioural capture: clicks (with rage/dead detection), scroll
 * depth, JavaScript errors and Core Web Vitals.
 *
 * These feed the "Insights" and "Performance" analytics. Everything here is
 * passive and throttled so it stays cheap on the visitor's device: listeners
 * are passive, high-frequency signals are sampled, and vitals use the browser's
 * own PerformanceObserver rather than a library.
 */

type Emit = (eventType: string, payload: Record<string, unknown>) => void;

const RAGE_WINDOW_MS = 1000;
const RAGE_RADIUS = 30;
const RAGE_MIN = 3;
const DEAD_WINDOW_MS = 1200;

export function installBehavior(emit: Emit): void {
  installClicks(emit);
  installScroll(emit);
  installViewportTrail(emit);
  installErrors(emit);
  installVitals(emit);
  installVisibility(emit);
}

// ------------------------------------------------------------- visibility
function installVisibility(emit: Emit): void {
  // Tells a live viewer when the visitor backgrounds the tab, returns, or
  // leaves the page — so "is this person still here?" is answerable.
  document.addEventListener("visibilitychange", () => {
    emit("visibility", { state: document.visibilityState === "hidden" ? "hidden" : "visible" });
  });
  // pagehide fires on navigation away / tab close; best-effort final signal.
  window.addEventListener("pagehide", () => {
    emit("visibility", { state: "left" });
  });
}

// --------------------------------------------------------------- clicks
function cssPath(el: Element | null): string {
  if (!el) return "";
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 4) {
    let sel = node.nodeName.toLowerCase();
    if (node.id) {
      sel += `#${node.id}`;
      parts.unshift(sel);
      break;
    }
    const cls = (node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean)[0];
    if (cls) sel += `.${cls}`;
    parts.unshift(sel);
    node = node.parentElement;
    depth++;
  }
  return parts.join(" > ").slice(0, 512);
}

/**
 * Whether the click handed focus to something.
 *
 * Focusing a field changes nothing about the document, so a DOM-diff heuristic
 * alone reports every single click into a form as "dead" — which turns the most
 * important interaction on a checkout page into the loudest false alarm in the
 * report. Focus landing on (or inside) the clicked element is proof the click
 * did something, even though the page looks identical afterwards.
 */
function focusLanded(target: Element | null, activeBefore: Element | null): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  if (active !== activeBefore) return true;
  return target ? active === target || target.contains(active) : false;
}

/**
 * Elements whose whole purpose is to receive input. Clicking one is meaningful
 * by definition, so they are never reported as dead even if focus was already
 * there (clicking a field you are already typing in, for instance).
 */
function isInteractive(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "OPTION" ||
    tag === "LABEL" ||
    (el as HTMLElement).isContentEditable === true
  );
}

function installClicks(emit: Emit): void {
  const recent: { x: number; y: number; t: number }[] = [];

  window.addEventListener(
    "click",
    (e: MouseEvent) => {
      const now = Date.now();
      const x = e.pageX;
      const y = e.pageY;

      // Rage: several clicks close together in space and time.
      recent.push({ x, y, t: now });
      while (recent.length && now - recent[0]!.t > RAGE_WINDOW_MS) recent.shift();
      const near = recent.filter((c) => Math.hypot(c.x - x, c.y - y) < RAGE_RADIUS);
      const rage = near.length >= RAGE_MIN;

      const target = e.target as Element | null;
      const urlBefore = location.href;
      const activeBefore = document.activeElement;

      // Watching for mutations answers "did the page react?" exactly, instead of
      // inferring it from a size difference. Counting nodes misses text-only
      // updates and single-node swaps; serialising innerHTML catches them but
      // stringifies the whole document twice per click on the visitor's device.
      // The observer costs nothing until something changes and is disconnected
      // as soon as the verdict is made.
      let mutated = false;
      let observer: MutationObserver | null = null;
      try {
        observer = new MutationObserver(() => {
          mutated = true;
          observer?.disconnect();
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden", "aria-expanded", "disabled"],
        });
      } catch {
        /* no observer available: fall back to navigation and focus alone */
      }

      // Dead: nothing changed, nowhere navigated, nothing focused.
      let settled = false;
      const markDead = () => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        const dead =
          location.href === urlBefore &&
          !mutated &&
          !focusLanded(target, activeBefore) &&
          !isInteractive(target);
        send(dead);
      };

      const send = (dead: boolean) => {
        emit("click", {
          target: cssPath(target),
          x,
          y,
          vw: window.innerWidth,
          text: (target?.textContent || "").trim().slice(0, 256) || undefined,
          rage: rage || undefined,
          dead: dead || undefined,
        });
      };

      setTimeout(markDead, DEAD_WINDOW_MS);
    },
    { passive: true, capture: true }
  );
}

// --------------------------------------------------------------- scroll
function installScroll(emit: Emit): void {
  let maxDepth = 0;
  let scheduled = false;

  const measure = () => {
    scheduled = false;
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - window.innerHeight;
    const depth = scrollable > 0 ? Math.min(100, Math.round((window.scrollY / scrollable) * 100)) : 100;
    if (depth > maxDepth) {
      maxDepth = depth;
      emit("scroll", { depthPct: maxDepth });
    }
  };

  window.addEventListener(
    "scroll",
    () => {
      if (scheduled) return;
      scheduled = true;
      // Sample at most ~3x/sec; only new max depths are ever sent.
      setTimeout(measure, 300);
    },
    { passive: true }
  );
}

// ------------------------------------------------------- viewport trail
/**
 * Where the visitor was on the page, over time.
 *
 * The scroll signal above is a ratchet — it only ever reports a new deepest
 * point — which answers "how far did they get" and nothing else. It cannot say
 * where someone was at second 12, that they scrolled back up to re-read the
 * price, or where they were sitting when they left. Both the abandonment
 * autopsy and the collective replay need position as a function of time.
 *
 * Samples are batched rather than sent individually: a sample per second on a
 * two-minute session would be 120 events, and the same information fits in a
 * handful of messages.
 */
const TRAIL_SAMPLE_MS = 1000;
const TRAIL_FLUSH_MS = 5000;
const TRAIL_MAX_SAMPLES = 60;

function installViewportTrail(emit: Emit): void {
  const startedAt = Date.now();
  let samples: { t: number; y: number; h: number }[] = [];
  let lastY = -1;

  const sample = () => {
    // Rubber-band overscroll on iOS reports a negative offset, which is not a
    // position anyone was ever at — and would fail validation, discarding the
    // entire batch of samples along with it.
    const y = Math.max(0, Math.round(window.scrollY));
    const h = Math.round(window.innerHeight);
    // Only record movement; a visitor reading motionless is captured by the
    // gap between samples, not by repeating the same row over and over.
    if (y === lastY && samples.length > 0) return;
    lastY = y;
    samples.push({ t: Date.now() - startedAt, y, h });
    if (samples.length >= TRAIL_MAX_SAMPLES) flush();
  };

  const flush = () => {
    if (samples.length === 0) return;
    emit("viewport", { samples });
    samples = [];
  };

  sample();
  setInterval(sample, TRAIL_SAMPLE_MS);
  setInterval(flush, TRAIL_FLUSH_MS);

  // The last position before leaving is the most valuable sample of all — it is
  // where the visitor gave up — so it is never left sitting in the buffer.
  window.addEventListener("pagehide", () => {
    sample();
    flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sample();
      flush();
    }
  });
}

// --------------------------------------------------------------- errors
function installErrors(emit: Emit): void {
  window.addEventListener("error", (e: ErrorEvent) => {
    if (!e.message) return;
    emit("error", {
      message: String(e.message).slice(0, 2048),
      stack: e.error?.stack ? String(e.error.stack).slice(0, 8192) : undefined,
      filename: e.filename?.slice(0, 2048),
      lineno: e.lineno,
      colno: e.colno,
    });
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const message = reason?.message ?? String(reason);
    emit("error", {
      message: `Unhandled promise rejection: ${String(message)}`.slice(0, 2048),
      stack: reason?.stack ? String(reason.stack).slice(0, 8192) : undefined,
    });
  });
}

// --------------------------------------------------------------- web vitals
type VitalName = "LCP" | "CLS" | "INP" | "FCP" | "TTFB";

const THRESHOLDS: Record<VitalName, [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

function rate(name: VitalName, value: number): "good" | "needs-improvement" | "poor" {
  const [g, ni] = THRESHOLDS[name];
  return value <= g ? "good" : value <= ni ? "needs-improvement" : "poor";
}

function installVitals(emit: Emit): void {
  const sent = new Set<VitalName>();

  // Paint-based metrics (LCP/FCP) are unreliable if the tab was ever hidden
  // before the paint — a backgrounded tab can report a paint tens of seconds
  // late. Track that and discard those metrics, matching web-vitals' behavior.
  let wasHidden = document.visibilityState === "hidden";
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") wasHidden = true;
  });

  const report = (name: VitalName, value: number) => {
    if (sent.has(name)) return;
    // Guard against implausible values (background-tab artifacts).
    if (value < 0 || value > 60000) return;
    if ((name === "LCP" || name === "FCP") && wasHidden) return;
    sent.add(name);
    emit("web-vitals", { name, value: Math.round(value * 1000) / 1000, rating: rate(name, value) });
  };

  // TTFB + FCP from navigation/paint timing.
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) queueReport(() => report("TTFB", nav.responseStart));
  } catch { /* ignore */ }

  observe("paint", (entries) => {
    for (const e of entries) if (e.name === "first-contentful-paint") report("FCP", e.startTime);
  });

  let lcp = 0;
  observe("largest-contentful-paint", (entries) => {
    const last = entries[entries.length - 1];
    if (last) lcp = last.startTime;
  });

  let cls = 0;
  observe("layout-shift", (entries) => {
    for (const e of entries as unknown as { value: number; hadRecentInput: boolean }[]) {
      if (!e.hadRecentInput) cls += e.value;
    }
  });

  let inp = 0;
  observe("event", (entries) => {
    for (const e of entries as unknown as { duration: number }[]) {
      if (e.duration > inp) inp = e.duration;
    }
  }, { durationThreshold: 40 } as PerformanceObserverInit);

  // Flush the "final value" vitals when the page is backgrounded/unloaded.
  const flush = () => {
    if (lcp) report("LCP", lcp);
    report("CLS", cls);
    if (inp) report("INP", inp);
  };
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  addEventListener("pagehide", flush);
}

function observe(type: string, cb: (entries: PerformanceEntry[]) => void, opts?: PerformanceObserverInit): void {
  try {
    const po = new PerformanceObserver((list) => cb(list.getEntries()));
    po.observe({ type, buffered: true, ...opts } as PerformanceObserverInit);
  } catch { /* unsupported entry type — skip */ }
}

function queueReport(fn: () => void): void {
  if (document.readyState === "complete") fn();
  else addEventListener("load", fn, { once: true });
}
