export const DEFAULT_POLL_INTERVAL_MS = 45_000;
export const REFRESH_COALESCE_MS = 1_500;

export type LiveRefreshReason =
  | "poll"
  | "visible"
  | "focus"
  | "online"
  | "pageshow";

export type LiveRefreshHost = {
  now: () => number;
  isOnline: () => boolean;
  visibilityState: () => DocumentVisibilityState;
  addDocumentListener: (type: string, listener: EventListener) => void;
  removeDocumentListener: (type: string, listener: EventListener) => void;
  addWindowListener: (type: string, listener: EventListener) => void;
  removeWindowListener: (type: string, listener: EventListener) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
};

export type LiveRefreshOptions = {
  onRefresh: (signal: AbortSignal, reason: LiveRefreshReason) => Promise<void>;
  pollIntervalMs?: number;
  coalesceMs?: number;
  host?: LiveRefreshHost;
};

export const browserLiveRefreshHost: LiveRefreshHost = {
  now: () => Date.now(),
  isOnline: () =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  visibilityState: () =>
    typeof document === "undefined" ? "visible" : document.visibilityState,
  addDocumentListener: (type, listener) => {
    document.addEventListener(type, listener);
  },
  removeDocumentListener: (type, listener) => {
    document.removeEventListener(type, listener);
  },
  addWindowListener: (type, listener) => {
    window.addEventListener(type, listener);
  },
  removeWindowListener: (type, listener) => {
    window.removeEventListener(type, listener);
  },
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => {
    window.clearInterval(id as number);
  },
};

export class LiveRefreshController {
  private readonly onRefresh: LiveRefreshOptions["onRefresh"];
  private readonly pollIntervalMs: number;
  private readonly coalesceMs: number;
  private readonly host: LiveRefreshHost;
  private readonly handleVisibility = () => {
    this.onVisibilityChange();
  };
  private readonly handleFocus = () => {
    this.onWindowFocus();
  };
  private readonly handleBlur = () => {
    this.seenBlur = true;
  };
  private readonly handleOnline = () => {
    this.onOnline();
  };
  private readonly handleOffline = () => {
    this.onOffline();
  };
  private readonly handlePageshow = (event: Event) => {
    this.onPageshow(event);
  };
  private readonly handlePoll = () => {
    void this.requestRefresh({
      reason: "poll",
      abortInFlight: false,
      coalesce: false,
    });
  };

  private started = false;
  private intervalId: unknown = null;
  private inFlight = false;
  private generation = 0;
  private currentAbort: AbortController | null = null;
  private lastImmediateAt = Number.NEGATIVE_INFINITY;
  private seenHidden = false;
  private seenBlur = false;

  constructor(options: LiveRefreshOptions) {
    this.onRefresh = options.onRefresh;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.coalesceMs = options.coalesceMs ?? REFRESH_COALESCE_MS;
    this.host = options.host ?? browserLiveRefreshHost;
  }

  get isInFlight(): boolean {
    return this.inFlight;
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.host.addDocumentListener("visibilitychange", this.handleVisibility);
    this.host.addWindowListener("focus", this.handleFocus);
    this.host.addWindowListener("blur", this.handleBlur);
    this.host.addWindowListener("online", this.handleOnline);
    this.host.addWindowListener("offline", this.handleOffline);
    this.host.addWindowListener("pageshow", this.handlePageshow);
    this.syncInterval();
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.host.removeDocumentListener("visibilitychange", this.handleVisibility);
    this.host.removeWindowListener("focus", this.handleFocus);
    this.host.removeWindowListener("blur", this.handleBlur);
    this.host.removeWindowListener("online", this.handleOnline);
    this.host.removeWindowListener("offline", this.handleOffline);
    this.host.removeWindowListener("pageshow", this.handlePageshow);
    this.clearInterval();
    this.abortInFlight();
  }

  private canRun(): boolean {
    return (
      this.started &&
      this.host.visibilityState() === "visible" &&
      this.host.isOnline()
    );
  }

  private syncInterval(): void {
    this.clearInterval();
    if (!this.canRun()) {
      return;
    }
    this.intervalId = this.host.setInterval(this.handlePoll, this.pollIntervalMs);
  }

  private clearInterval(): void {
    if (this.intervalId != null) {
      this.host.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private abortInFlight(): void {
    this.generation += 1;
    this.currentAbort?.abort();
    this.currentAbort = null;
    this.inFlight = false;
  }

  private onVisibilityChange(): void {
    if (this.host.visibilityState() !== "visible") {
      this.seenHidden = true;
      this.clearInterval();
      this.abortInFlight();
      return;
    }

    this.syncInterval();
    void this.requestRefresh({
      reason: "visible",
      abortInFlight: true,
      coalesce: true,
    });
  }

  private onWindowFocus(): void {
    if (!this.seenHidden && !this.seenBlur) {
      return;
    }

    if (!this.canRun()) {
      return;
    }

    void this.requestRefresh({
      reason: "focus",
      abortInFlight: true,
      coalesce: true,
    });
  }

  private onOnline(): void {
    this.syncInterval();
    if (!this.canRun()) {
      return;
    }

    void this.requestRefresh({
      reason: "online",
      abortInFlight: true,
      coalesce: true,
    });
  }

  private onOffline(): void {
    this.clearInterval();
    this.abortInFlight();
  }

  private onPageshow(event: Event): void {
    const persisted =
      "persisted" in event &&
      (event as { persisted?: unknown }).persisted === true;

    if (!persisted || !this.canRun()) {
      return;
    }

    void this.requestRefresh({
      reason: "pageshow",
      abortInFlight: true,
      coalesce: true,
    });
  }

  private async requestRefresh(options: {
    reason: LiveRefreshReason;
    abortInFlight: boolean;
    coalesce: boolean;
  }): Promise<void> {
    if (!this.started) {
      return;
    }

    if (options.reason === "poll" && !this.canRun()) {
      return;
    }

    if (!options.abortInFlight && this.inFlight) {
      return;
    }

    const now = this.host.now();
    if (
      options.coalesce &&
      now - this.lastImmediateAt < this.coalesceMs
    ) {
      return;
    }

    if (options.coalesce) {
      this.lastImmediateAt = now;
    }

    if (options.abortInFlight) {
      this.abortInFlight();
    }

    const generation = this.generation + 1;
    this.generation = generation;
    const abort = new AbortController();
    this.currentAbort = abort;
    this.inFlight = true;

    try {
      await this.onRefresh(abort.signal, options.reason);
    } catch {
      // Callers handle UI errors. The controller must keep polling.
    } finally {
      if (this.generation === generation) {
        this.inFlight = false;
        if (this.currentAbort === abort) {
          this.currentAbort = null;
        }
      }
    }
  }
}
