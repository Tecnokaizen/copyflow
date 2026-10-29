import type { SupabaseClient } from "@supabase/supabase-js";

import { tenantHasFeature } from "@/lib/features/tenant-has-feature";

// SUR4 (ADR SUR4-01, contract §4): the four A1 features of the order page and
// its documents. All are born off; `tenant_has_feature` answers false for a
// code that does not exist yet, so callers work before and after E5/E7.
export const ORDER_FEATURE_CODES = {
  customLabels: "order_custom_labels",
  stickyNotes: "order_sticky_notes",
  workSequence: "order_work_sequence",
  workSheetFicha: "order_work_sheet_ficha",
} as const;

export type OrderFeatureKey = keyof typeof ORDER_FEATURE_CODES;
export type OrderFeatures = Record<OrderFeatureKey, boolean>;

export const NO_ORDER_FEATURES: OrderFeatures = {
  customLabels: false,
  stickyNotes: false,
  workSequence: false,
  workSheetFicha: false,
};

// Server only: the client never decides which features a tenant has.
export async function loadOrderFeatures(
  supabase: SupabaseClient,
  tenantId: string
): Promise<OrderFeatures> {
  const keys = Object.keys(ORDER_FEATURE_CODES) as OrderFeatureKey[];
  const values = await Promise.all(
    keys.map((key) => tenantHasFeature(supabase, tenantId, ORDER_FEATURE_CODES[key]))
  );
  return Object.fromEntries(keys.map((key, index) => [key, values[index] === true])) as OrderFeatures;
}
