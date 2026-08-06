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

const FLUSH_INTERVAL_MS = 250;
const MAX_FRAMES_PER_CHUNK = 500;

interface RrwebGlobal {
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

  constructor(
    private readonly scriptUrl: string,
    private readonly onChunk: (frames: unknown[], seq: number) => void
  ) {}

  get isRecording(): boolean {
    return this.stopFn !== null;
  }

  async start(): Promise<void> {
    if (this.isRecording) return;

    await loadRrweb(this.scriptUrl);
    const rrweb = window.rrweb;
    if (!rrweb) throw new Error("recorder loaded but window.rrweb is missing");

    this.stopFn =
      rrweb.record({
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
        // Throttle the two highest-frequency signals; 50ms of mouse resolution
        // is imperceptible on playback but cuts frame volume dramatically.
        sampling: { mousemove: 50, scroll: 100, input: "last" },
      }) ?? null;

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
