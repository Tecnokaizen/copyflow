import type { ReactNode } from "react";

import type { OrderCollection } from "@/lib/orders/collection";
import type { OrderLabels } from "@/lib/orders/labels";
import type { OrderFeatures } from "@/lib/orders/order-features";
import type { Order, OrderStatus } from "@/lib/orders/types";

// Order Detail Views V1 — the layout contract.
//
// OrderWorkspace builds every module once and hands them to one layout. A
// layout only decides where each module goes:
// - it places every non-null module exactly once (header OR headerCompact);
// - it never loads data or keeps data state;
// - hiding is not unmounting: tabs use `hidden` and folds use <details>, so a
//   module keeps its state (uploads, forms) and never loads twice;
// - feature-gated modules arrive as null without the A1 grant;
// - dialogs (client, terminal-status confirmation) stay outside the layout.

export const ORDER_DETAIL_MODULE_KEYS = [
  "notices",
  "header",
  "headerCompact",
  "pinnedNotes",
  "sequence",
  "tracking",
  "sourceQuote",
  "production",
  "files",
  "summary",
  "fulfillment",
  "stickyNotes",
  "legacyNotes",
  "activity",
] as const;

export type OrderDetailModuleKey = (typeof ORDER_DETAIL_MODULE_KEYS)[number];

export type OrderDetailModules = Record<OrderDetailModuleKey, ReactNode>;

/** Read-only facts a layout may use for its own labels and empty states. */
export type OrderDetailFacts = {
  order: Order;
  labels: OrderLabels;
  features: OrderFeatures;
  collection: OrderCollection | null;
  statuses: OrderStatus[];
  canMutate: boolean;
  archived: boolean;
  editing: boolean;
  /**
   * Increments on each header «Añadir nota» (post-its on). A layout that
   * hides the post-its panel must reveal it in the same render, because the
   * panel scrolls to its composer right after.
   */
  noteComposeRequest: number;
};

export type OrderDetailLayoutProps = {
  modules: OrderDetailModules;
  facts: OrderDetailFacts;
};
