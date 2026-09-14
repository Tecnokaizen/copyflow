"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  DEFAULT_POLL_INTERVAL_MS,
  LiveRefreshController,
  browserLiveRefreshHost,
} from "@/lib/refresh/controller";

type UseLiveRefreshOptions = {
  onRefresh: (signal: AbortSignal) => Promise<void>;
  enabled?: boolean;
  pollIntervalMs?: number;
};

export function useLiveRefresh(options: UseLiveRefreshOptions): void {
  const onRefreshRef = useRef(options.onRefresh);
  const enabled = options.enabled ?? true;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  useLayoutEffect(() => {
    onRefreshRef.current = options.onRefresh;
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const controller = new LiveRefreshController({
      pollIntervalMs,
      host: browserLiveRefreshHost,
      onRefresh: (signal) => onRefreshRef.current(signal),
    });
    controller.start();

    return () => {
      controller.stop();
    };
  }, [enabled, pollIntervalMs]);
}
