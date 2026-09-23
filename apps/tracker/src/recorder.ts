/**
 * On-demand screen recorder.
 *
 * rrweb is ~40 KB gzip — far more than the whole core tracker — so it is never
 * part of the main bundle. It is fetched as a separate script the first time a
 * viewer asks to watch this session, which means a visitor nobody is watching
 * downloads nothing extra, runs no MutationObserver, and sends no frames.
 * Always-on recorders (Clarity, Hotjar) pay that cost on every pageview.
 *
 * Frames are batched on an interval instead of sent per-mutation: a busy page
 * can emit hundreds of mutations per second, and one WebSocket message per
 * mutation would dominate both CPU and bandwidth.
 */

// How often buffered frames are shipped. This is the dominant knob for how
// "live" the stream feels: at 250ms the viewer only got ~4 updates/sec, which
// reads as choppy. 60ms gives ~16 updates/sec — smooth — and only runs while
// someone is actually watching, so the extra messages cost nothing otherwise.
const FLUSH_INTERVAL_MS = 60;
const MAX_FRAMES_PER_CHUNK = 500;

interface RrwebGlobal {
  /** Forces a fresh full-DOM snapshot into the stream. */
  takeFullSnapshot?: (isCheckout?: boolean) => void;
  record: (options: {
    emit: (event: unknown) => void;
    maskAllInputs?: boolean;
    maskTextClass?: string;
    blockClass?: string;
    recordCanvas?: boolean;
    collectFonts?: boolean;
    sampling?: { mousemove?: number; scroll?: number; input?: string };
  }) => (() => void) | undefined;
}

declare global {
  interface Window {
    rrweb?: RrwebGlobal;
    __rtaRecorderUrl?: string;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadRrweb(scriptUrl: string): Promise<void> {
  if (window.rrweb) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = scriptUrl;
    el.async = true;
    el.crossOrigin = "anonymous";
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null;
      reject(new Error(`failed to load recorder from ${scriptUrl}`));
    };
    document.head.appendChild(el);
  });

  return scriptPromise;
}

export class Recorder {
  private stopFn: (() => void) | null = null;
  private buffer: unknown[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  /**
   * Set synchronously before the first `await` in start().
   *
   * The watcher re-sends "start-recording" on a timer, and more than one
   * viewer can watch the same session. Without a synchronous guard, two calls
   * both observe `stopFn === null` while the script is still loading, both
   * call rrweb.record(), and the second one leaves the recorder in a state
   * where nothing is emitted.
   */
  private starting = false;

  constructor(
    private readonly scriptUrl: string,
    private readonly onChunk: (frames: unknown[], seq: number) => void
  ) {}

  get isRecording(): boolean {
    return this.stopFn !== null;
  }

  /**
   * @param forceSnapshot true when a new viewer arrived. A viewer cannot
   * render anything until a full DOM snapshot arrives, and rrweb only emits
   * one when recording begins — so someone joining an in-progress recording
   * would stare at an empty player forever without this. Keepalives pass
   * false, since full snapshots are large and would waste bandwidth.
   */
  async start(forceSnapshot = false): Promise<void> {
    if (this.isRecording) {
      if (forceSnapshot) window.rrweb?.takeFullSnapshot?.(true);
      return;
    }
    if (this.starting) return;
    this.starting = true;

    try {
      await this.startInternal();
    } finally {
      this.starting = false;
    }
  }

  private async startInternal(): Promise<void> {
    try {
      await loadRrweb(this.scriptUrl);
    } catch (err) {
      // Surface the failure so the dashboard can diagnose it from server logs.
      console.error("[rtanalytics] recorder script failed to load:", err);
      throw err;
    }
    const rrweb = window.rrweb;
    if (!rrweb) {
      const msg = "recorder loaded but window.rrweb is missing";
      console.error(`[rtanalytics] ${msg}`);
      throw new Error(msg);
    }
    if (typeof rrweb.record !== "function") {
      const msg = `window.rrweb.record is not a function (got ${typeof rrweb.record})`;
      console.error(`[rtanalytics] ${msg}`);
      throw new Error(msg);
    }

    const stop = rrweb.record({
        emit: (event) => {
          this.buffer.push(event);
          // Hard cap protects memory if the connection stalls mid-burst.
          if (this.buffer.length > MAX_FRAMES_PER_CHUNK * 4) {
            this.buffer.splice(0, this.buffer.length - MAX_FRAMES_PER_CHUNK * 4);
          }
        },
        // Privacy defaults, on by design rather than opt-in: every input value
        // is masked, so passwords, card numbers and personal data never leave
        // the visitor's browser.
        maskAllInputs: true,
        maskTextClass: "rta-mask",
        blockClass: "rta-block",
        recordCanvas: false,
        collectFonts: false,
        // Capture the cursor at ~50fps and scroll at ~30fps so playback is
        // fluid. rrweb records mousemove as timestamped position arrays that
        // the replayer interpolates, so this is what makes the pointer glide
        // rather than jump.
        sampling: { mousemove: 20, scroll: 33, input: "last" },
      });

    // rrweb returns undefined if it refused to start. Treating that as
    // "recording" would leave a viewer staring at an empty player forever, so
    // surface it instead.
    if (typeof stop !== "function") {
      throw new Error("rrweb.record() did not start");
    }

    this.stopFn = stop;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
    this.stopFn?.();
    this.stopFn = null;
    this.buffer = [];
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const frames = this.buffer.splice(0, MAX_FRAMES_PER_CHUNK);
    this.seq += 1;
    this.onChunk(frames, this.seq);
  }
}
