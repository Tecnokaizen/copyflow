"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { notesErrorMessage, orderNotesApi } from "@/lib/orders/notes/client";
import type { OrderNoteView, OrderNotesListResponse } from "@/lib/orders/notes/types";
import { useLiveRefresh } from "@/lib/refresh/use-live-refresh";

export type OrderNotesContextValue = {
  orderId: string;
  enabled: boolean;
  data: OrderNotesListResponse | null;
  loading: boolean;
  error: string | null;
  includeVoided: boolean;
  setIncludeVoided: (value: boolean) => void;
  /** Open pinned notes, newest first (the strip shows up to three). */
  pinned: OrderNoteView[];
  reload: () => Promise<void>;
};

const OrderNotesContext = createContext<OrderNotesContextValue | null>(null);

/**
 * One request shared by the pinned strip, the panel and the «Notas anteriores»
 * card. `enabled` is the server's order_sticky_notes answer: when false nothing
 * is fetched and the post-it components render nothing.
 */
export function OrderNotesProvider({
  orderId,
  enabled = true,
  children,
}: {
  orderId: string;
  enabled?: boolean;
  children: ReactNode;
}) {
  const [includeVoided, setIncludeVoided] = useState(false);
  // Results are keyed by what was asked, so «loading» is derived and no state
  // is set synchronously when the order or the voided toggle change.
  const [result, setResult] = useState<{ key: string; data: OrderNotesListResponse } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const key = `${orderId}|${includeVoided ? "voided" : "active"}`;

  const load = useCallback(
    (options: { silent?: boolean; signal?: AbortSignal } = {}): Promise<void> => {
      if (!enabled) return Promise.resolve();
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
      const done = () => {
        if (requestRef.current === controller) requestRef.current = null;
      };
      return orderNotesApi.list(orderId, { includeVoided, signal: controller.signal }).then(
        (next) => {
          done();
          if (controller.signal.aborted) return;
          setResult({ key, data: next });
          setFailure(null);
        },
        (caught: unknown) => {
          done();
          if (controller.signal.aborted) return;
          // A silent refresh keeps the last good list on screen.
          if (!options.silent) setFailure({ key, message: notesErrorMessage(caught) });
        }
      );
    },
    [enabled, orderId, includeVoided, key]
  );

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  useLiveRefresh({
    enabled,
    onRefresh: (signal) => load({ silent: true, signal }),
  });

  const reload = useCallback(() => load({ silent: true }), [load]);

  const value = useMemo<OrderNotesContextValue>(() => {
    // Keep the previous list visible while the voided toggle reloads it.
    const data = enabled && result?.data.order_id === orderId ? result.data : null;
    const pinned = (data?.notes ?? [])
      .filter((note) => note.pinned && note.state === "open")
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    return {
      orderId,
      enabled,
      data,
      loading: enabled && result?.key !== key && failure?.key !== key,
      error: enabled && failure?.key === key ? failure.message : null,
      includeVoided,
      setIncludeVoided,
      pinned,
      reload,
    };
  }, [orderId, enabled, result, failure, key, includeVoided, reload]);

  return <OrderNotesContext.Provider value={value}>{children}</OrderNotesContext.Provider>;
}

export function useOrderNotes(): OrderNotesContextValue {
  const value = useContext(OrderNotesContext);
  if (!value) {
    throw new Error("useOrderNotes must be used inside <OrderNotesProvider>");
  }
  return value;
}

/** Same as useOrderNotes, but null outside a provider (the legacy notes card works with or without it). */
export function useOptionalOrderNotes(): OrderNotesContextValue | null {
  return useContext(OrderNotesContext);
}
