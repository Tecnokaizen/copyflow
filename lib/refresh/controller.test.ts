import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LiveRefreshController,
  type LiveRefreshHost,
  type LiveRefreshReason,
} from "./controller";

type Timer = {
  fireAt: number;
  fn: () => void;
  interval?: number;
};

class FakeHost implements LiveRefreshHost {
  nowMs = 0;
  online = true;
  visibility: DocumentVisibilityState = "visible";
  documentListeners = new Map<string, Set<EventListener>>();
  windowListeners = new Map<string, Set<EventListener>>();
  timers = new Map<number, Timer>();
  nextTimerId = 1;
  clearedTimerIds: number[] = [];

  now = () => this.nowMs;
  isOnline = () => this.online;
  visibilityState = () => this.visibility;

  addDocumentListener = (type: string, listener: EventListener) => {
    this.listenersFor(this.documentListeners, type).add(listener);
  };

  removeDocumentListener = (type: string, listener: EventListener) => {
    this.documentListeners.get(type)?.delete(listener);
  };

  addWindowListener = (type: string, listener: EventListener) => {
    this.listenersFor(this.windowListeners, type).add(listener);
  };

  removeWindowListener = (type: string, listener: EventListener) => {
    this.windowListeners.get(type)?.delete(listener);
  };

  setInterval = (fn: () => void, ms: number) => {
    const id = this.nextTimerId++;
    this.timers.set(id, { fireAt: this.nowMs + ms, fn, interval: ms });
    return id;
  };

  clearInterval = (id: unknown) => {
    const timerId = typeof id === "number" ? id : Number(id);
    this.timers.delete(timerId);
    this.clearedTimerIds.push(timerId);
  };

  dispatchDocument(type: string, event?: Event) {
    const payload = event ?? new Event(type);
    for (const listener of [...(this.documentListeners.get(type) ?? [])]) {
      listener.call(undefined, payload);
    }
  }

  dispatchWindow(type: string, event?: Event) {
    const payload = event ?? new Event(type);
    for (const listener of [...(this.windowListeners.get(type) ?? [])]) {
      listener.call(undefined, payload);
    }
  }

  setHidden() {
    this.visibility = "hidden";
    this.dispatchDocument("visibilitychange");
  }

  setVisible() {
    this.visibility = "visible";
    this.dispatchDocument("visibilitychange");
  }

  setOffline() {
    this.online = false;
    this.dispatchWindow("offline");
  }

  setOnline() {
    this.online = true;
    this.dispatchWindow("online");
  }

  advance(ms: number) {
    const target = this.nowMs + ms;
    while (true) {
      let next: Timer | null = null;
      let nextId: number | null = null;
      for (const [id, timer] of this.timers) {
        if (timer.fireAt > target) {
          continue;
        }
        if (!next || timer.fireAt < next.fireAt) {
          next = timer;
          nextId = id;
        }
      }

      if (!next || nextId == null) {
        this.nowMs = target;
        return;
      }

      this.nowMs = next.fireAt;
      if (next.interval != null) {
        next.fireAt = next.fireAt + next.interval;
      } else {
        this.timers.delete(nextId);
      }
      next.fn();
    }
  }

  private listenersFor(
    map: Map<string, Set<EventListener>>,
    type: string
  ): Set<EventListener> {
    const existing = map.get(type);
    if (existing) {
      return existing;
    }
    const created = new Set<EventListener>();
    map.set(type, created);
    return created;
  }
}

type RefreshCall = {
  reason: LiveRefreshReason;
  signal: AbortSignal;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("LiveRefreshController", () => {
  it("does not refresh on start; polls while the tab is visible and online", async () => {
    const host = new FakeHost();
    const calls: RefreshCall[] = [];
    const controller = new LiveRefreshController({
      pollIntervalMs: 1_000,
      host,
      onRefresh: async (signal, reason) => {
        calls.push({ signal, reason });
      },
    });

    controller.start();
    assert.equal(calls.length, 0);

    host.advance(999);
    await flush();
    assert.equal(calls.length, 0);

    host.advance(1);
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.reason, "poll");

    host.advance(1_000);
    await flush();
    assert.equal(calls.length, 2);

    controller.stop();
  });

  it("pauses polling while hidden and refreshes immediately on visible", async () => {
    const host = new FakeHost();
    const calls: RefreshCall[] = [];
    const controller = new LiveRefreshController({
      pollIntervalMs: 1_000,
      host,
      onRefresh: async (signal, reason) => {
        calls.push({ signal, reason });
      },
    });

    controller.start();
    host.setHidden();
    host.advance(5_000);
    await flush();
    assert.equal(calls.length, 0);

    host.setVisible();
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.reason, "visible");

    host.advance(1_000);
    await flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.reason, "poll");

    controller.stop();
  });

  it("pauses polling while offline and refreshes when back online", async () => {
    const host = new FakeHost();
    const calls: RefreshCall[] = [];
    const controller = new LiveRefreshController({
      pollIntervalMs: 1_000,
      host,
      onRefresh: async (signal, reason) => {
        calls.push({ signal, reason });
      },
    });

    controller.start();
    host.setOffline();
    host.advance(5_000);
    await flush();
    assert.equal(calls.length, 0);

    host.setOnline();
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.reason, "online");

    controller.stop();
  });

  it("does not refresh on online while the tab is hidden", async () => {
    const host = new FakeHost();
    const calls: RefreshCall[] = [];
    const controller = new LiveRefreshController({
      pollIntervalMs: 1_000,
      host,
      onRefresh: async (signal, reason) => {
        calls.push({ signal, reason });
      },
    });

    controller.start();
    host.setHidden();
    host.setOffline();
    host.setOnline();
    await flush();
    assert.equal(calls.length, 0);

    controller.stop();
  });

  it("skips a poll while a request is in flight", async () => {
    const host = new FakeHost();
    const pending = deferred();
    let started = 0;
    const controller = new LiveRefreshController({
      pollIntervalMs: 1_000,
      host,
      onRefresh: async () => {
        started += 1;
        if (started === 1) {
          await pending.promise;
        }
      },
    });

    controller.start();
    host.advance(1_000);
    await flush();
    assert.equal(started, 1);
    assert.equal(controller.isInFlight, true);

    host.advance(1_000);
    await flush();
    assert.equal(started, 1);

    pending.resolve();
    await flush();
    host.advance(1_000);
    await flush();
    assert.equal(started, 2);

    controller.stop();
  });

  it("aborts an in-flight poll when the tab becomes visible", async () => {
    const host = new FakeHost();
    const first = deferred();
    const signals: AbortSignal[] = [];
    const reasons: LiveRefreshReason[] = [];
    const controller = new LiveRefreshController({
      pollIntervalMs: 1_000,
      host,
      onRefresh: async (signal, reason) => {
        signals.push(signal);
        reasons.push(reason);
        if (reason === "poll") {
          await first.promise;
        }
      },
    });

    controller.start();
    host.advance(1_000);
    await flush();
    assert.equal(signals[0]?.aborted, false);

    host.setHidden();
    assert.equal(signals[0]?.aborted, true);

    host.setVisible();
    await flush();
    assert.equal(reasons.at(-1), "visible");
    first.resolve();
    await flush();

    controller.stop();
  });

  it("ignores focus until the window has blurred or the tab was hidden", async () => {
    const host = new FakeHost();
    const calls: RefreshCall[] = [];
    const controller = new LiveRefreshController({
      pollIntervalMs: 5_000,
      host,
      onRefresh: async (signal, reason) => {
        calls.push({ signal, reason });
      },
    });

    controller.start();
    host.dispatchWindow("focus");
    await flush();
    assert.equal(calls.length, 0);

    host.dispatchWindow("blur");
    host.dispatchWindow("focus");
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.reason, "focus");

    controller.stop();
  });

  it("does not duplicate a visibility refresh with an immediate focus", async () => {
    const host = new FakeHost();
    const calls: RefreshCall[] = [];
    const controller = new LiveRefreshController({
      pollIntervalMs: 5_000,
      coalesceMs: 1_500,
      host,
      onRefresh: async (signal, reason) => {
        calls.push({ signal, reason });
      },
    });

    controller.start();
    host.setHidden();
    host.setVisible();
    host.dispatchWindow("focus");
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.reason, "visible");

    host.advance(1_500);
    host.dispatchWindow("focus");
    await flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.reason, "focus");

    controller.stop();
  });

  it("refreshes on persisted pageshow and ignores a normal pageshow", async () => {
    const host = new FakeHost();
    const calls: RefreshCall[] = [];
    const controller = new LiveRefreshController({
      pollIntervalMs: 5_000,
      host,
      onRefresh: async (signal, reason) => {
        calls.push({ signal, reason });
      },
    });

    controller.start();
    host.dispatchWindow("pageshow", new Event("pageshow"));
    await flush();
    assert.equal(calls.length, 0);

    const persisted = new Event("pageshow");
    Object.defineProperty(persisted, "persisted", { value: true });
    host.dispatchWindow("pageshow", persisted);
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.reason, "pageshow");

    controller.stop();
  });

  it("cleans up timers and listeners on stop so polling cannot continue", async () => {
    const host = new FakeHost();
    const calls: RefreshCall[] = [];
    const controller = new LiveRefreshController({
      pollIntervalMs: 1_000,
      host,
      onRefresh: async (signal, reason) => {
        calls.push({ signal, reason });
      },
    });

    controller.start();
    controller.stop();

    host.advance(10_000);
    host.setVisible();
    host.setOnline();
    host.dispatchWindow("focus");
    await flush();

    assert.equal(calls.length, 0);
    assert.equal(host.documentListeners.get("visibilitychange")?.size ?? 0, 0);
    assert.equal(host.windowListeners.get("focus")?.size ?? 0, 0);
    assert.equal(host.timers.size, 0);
  });

  it("keeps polling after a temporary refresh error", async () => {
    const host = new FakeHost();
    let attempts = 0;
    const controller = new LiveRefreshController({
      pollIntervalMs: 1_000,
      host,
      onRefresh: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary");
        }
      },
    });

    controller.start();
    host.advance(1_000);
    await flush();
    assert.equal(attempts, 1);

    host.advance(1_000);
    await flush();
    assert.equal(attempts, 2);

    controller.stop();
  });
});
