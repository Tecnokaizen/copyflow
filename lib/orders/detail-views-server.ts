import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_ORDER_DETAIL_VIEW,
  resolveOrderDetailView,
  type OrderDetailViewCode,
} from "@/lib/orders/detail-views";

// Server only. Any member can read tenant_settings (RLS select_member). A
// failed read never breaks the order page: it falls back to the classic view.
export async function loadOrderDetailView(
  supabase: SupabaseClient,
  tenantId: string
): Promise<OrderDetailViewCode> {
  try {
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("preferences")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return DEFAULT_ORDER_DETAIL_VIEW;
    return resolveOrderDetailView(data.preferences);
  } catch {
    return DEFAULT_ORDER_DETAIL_VIEW;
  }
}
