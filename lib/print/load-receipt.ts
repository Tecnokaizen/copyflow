import type { SupabaseClient } from "@supabase/supabase-js";

import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { ORDER_FEATURE_CODES } from "@/lib/orders/order-features";
import {
  CUSTOMER_RECEIPT_SELECT,
  customerReceiptModel,
  type CustomerReceiptSource,
} from "@/lib/print/receipt";
import type { CustomerReceiptModel } from "@/lib/print/types";
import { loadCollectionAmounts } from "@/lib/print/work-sheet-queries";
import { isUuid } from "@/lib/team/payload";
import {
  brandColorFromBranding,
  displayBusinessName,
  logoKeyBelongsToTenant,
  quoteFooterFromBranding,
  storedLogoFromBranding,
  type StoredLogo,
} from "@/lib/tenant/branding";
import { resolveTimeZone } from "@/lib/time/zoned-day";

export type CustomerReceiptLoad =
  | { status: "not_found" }
  | { status: "ok"; model: CustomerReceiptModel; logo: StoredLogo | null };

/**
 * SUR4 E4: own loader of the customer receipt. The caller already checked the
 * session (requireCurrentAccess); the tenant always comes from it, never from
 * the request. Same document for every tenant: no feature gate, only the
 * names of the amounts follow order_custom_labels (N16).
 */
export async function loadCustomerReceipt(
  id: string,
  access: { supabase: SupabaseClient; tenant: { id: string; name: string } },
  now: Date = new Date()
): Promise<CustomerReceiptLoad> {
  if (!isUuid(id)) return { status: "not_found" };
  const { supabase, tenant } = access;

  const { data: order, error } = await supabase
    .from("orders")
    .select(CUSTOMER_RECEIPT_SELECT)
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (error || !order) return { status: "not_found" };

  const [{ data: settings }, customLabels, amounts] = await Promise.all([
    supabase
      .from("tenant_settings")
      .select("business_name, branding, timezone")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    tenantHasFeature(supabase, tenant.id, ORDER_FEATURE_CODES.customLabels),
    loadCollectionAmounts(supabase, id),
  ]);

  const branding = settings?.branding;
  const logo = storedLogoFromBranding(branding);

  return {
    status: "ok",
    logo: logo && logoKeyBelongsToTenant(logo.storageKey, tenant.id) ? logo : null,
    model: customerReceiptModel(order as unknown as CustomerReceiptSource, {
      customLabels,
      amounts,
      businessName: displayBusinessName({
        businessName: settings?.business_name,
        tenantName: tenant.name,
      }),
      brandColor: brandColorFromBranding(branding) || "#163b4c",
      footer: quoteFooterFromBranding(branding),
      timeZone: resolveTimeZone(settings?.timezone),
      printedAt: now,
    }),
  };
}
