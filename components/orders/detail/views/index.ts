import type { ComponentType } from "react";

import type { OrderDetailViewCode } from "@/lib/orders/detail-views";
import { ClassicOrderLayout } from "@/components/orders/detail/views/classic-layout";
import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";

type LayoutEntry = {
  Layout: ComponentType<OrderDetailLayoutProps>;
  /** Max width of the page frame for this layout. */
  frameClassName: string;
};

// Registry of built layouts. A code without an entry renders the classic page.
const LAYOUTS: Partial<Record<OrderDetailViewCode, LayoutEntry>> = {
  classic: { Layout: ClassicOrderLayout, frameClassName: "max-w-5xl" },
};

/** Built layouts, for the contract tests. */
export function builtOrderDetailLayouts(): Array<[OrderDetailViewCode, LayoutEntry]> {
  return Object.entries(LAYOUTS) as Array<[OrderDetailViewCode, LayoutEntry]>;
}

export function orderDetailLayout(code: OrderDetailViewCode): LayoutEntry {
  return LAYOUTS[code] ?? (LAYOUTS.classic as LayoutEntry);
}
