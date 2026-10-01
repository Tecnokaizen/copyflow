import "server-only";

import { cache } from "react";
import { toPublicOrderDto } from "@/lib/files/dto";
import {
  orderPrintModel,
  printBranding,
  type OrderPrintSource,
} from "@/lib/print/order-document";
import type { OrderPrintModel } from "@/lib/print/types";
import { createClient } from "@/lib/supabase/server";
import { publicOrganizationIdentity } from "@/lib/tenant/branding";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { resolveTimeZone } from "@/lib/time/zoned-day";
import { isUuid } from "@/lib/team/payload";

const ORDER_PRINT_SELECT = `
  id,
  reference,
  title,
  description,
  priority,
  due_at,
  received_at,
  ready_at,
  delivered_at,
  archived_at,
  customer_notification_status,
  customer_notified_at,
  customer_notified_by,
  notes,
  client_id,
  status_id,
  service_id,
  entry_channel_id,
  assigned_team_member_id,
  order_context_id,
  store_id,
  file_status_id,
  quote_status_id,
  payment_status_id,
  delivery_method_id,
  external_folder_url,
  row_version,
  client:clients(
    id,
    customer_type_id,
    name,
    contact_name,
    company_name,
    tax_id,
    email,
    phone,
    notes,
    active
  ),
  service:services(id, name, active),
  status:order_statuses(id, code, name, is_initial, is_ready, is_closed, is_cancelled, active),
  entry_channel:entry_channels(id, code, name, active),
  assigned_team_member:team_members(id, name, active),
  order_context:order_contexts(id, name, active),
  store:stores(id, name, active),
  file_status:file_statuses(id, code, name, active),
  quote_status:quote_statuses(id, code, name, active),
  payment_status:payment_statuses(id, code, name, active),
  delivery_method:delivery_methods(id, code, name, active)
`;

export type OrderPrintLoad =
  | { status: "denied" }
  | { status: "not_found" }
  | { status: "ok"; model: OrderPrintModel };

export const loadOrderPrint = cache(async function loadOrderPrint(
  id: string
): Promise<OrderPrintLoad> {
  const context = await getCurrentContext();
  if (!context) {
    return { status: "denied" };
  }

  if (!isUuid(id)) {
    return { status: "not_found" };
  }

  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(ORDER_PRINT_SELECT)
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (error || !order) {
    return { status: "not_found" };
  }

  const dto = toPublicOrderDto(order as Record<string, unknown>);
  const [{ data: files }, { data: settings }] = await Promise.all([
    supabase
      .from("order_files")
      .select("original_name, created_at")
      .eq("tenant_id", context.tenant.id)
      .eq("order_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("tenant_settings")
      .select("business_name, branding, timezone")
      .eq("tenant_id", context.tenant.id)
      .maybeSingle(),
  ]);

  const identity = publicOrganizationIdentity({
    businessName: settings?.business_name,
    tenantName: context.tenant.name,
    branding: settings?.branding,
  });

  return {
    status: "ok",
    model: orderPrintModel(dto as OrderPrintSource, {
      files: (files ?? []).map((file) => file.original_name),
      branding: printBranding({
        displayName: identity.display_name,
        logoUrl: identity.logo_url,
        brandColor: identity.branding.brand_color,
      }),
      timeZone: resolveTimeZone(settings?.timezone),
    }),
  };
});
