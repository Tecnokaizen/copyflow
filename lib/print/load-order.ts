import "server-only";

import { cache } from "react";
import { loadOrderFeatures } from "@/lib/orders/order-features";
import {
  printBranding,
  workSheetModel,
  type WorkSheetSource,
} from "@/lib/print/order-document";
import type { WorkSheetModel } from "@/lib/print/types";
import {
  countActiveStores,
  hasLegacyNotes,
  loadCollectionAmounts,
  loadOrderFileNames,
  loadPrintableNoteRows,
  loadWorkSheetSteps,
} from "@/lib/print/work-sheet-queries";
import { workSheetProfile } from "@/lib/print/work-sheet-rules";
import { createClient } from "@/lib/supabase/server";
import { publicOrganizationIdentity } from "@/lib/tenant/branding";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { resolveTimeZone } from "@/lib/time/zoned-day";
import { isUuid } from "@/lib/team/payload";

/**
 * SUR4 E2 (contract §6): the closed list of order fields of the work sheet.
 * Never orders.notes, clients.notes or external_folder_url (a code test
 * fails if any of them is added).
 */
export const WORK_SHEET_SELECT = `
  reference,
  title,
  description,
  priority,
  due_at,
  received_at,
  ready_at,
  delivered_at,
  customer_notification_status,
  client:clients(name, contact_name, company_name, email, phone),
  service:services(name),
  status:order_statuses(name),
  entry_channel:entry_channels(name),
  assigned_team_member:team_members!orders_team_member_fk(name),
  order_context:order_contexts(name),
  store:stores(name),
  file_status:file_statuses(name),
  quote_status:quote_statuses(name),
  payment_status:payment_statuses(name),
  delivery_method:delivery_methods(name)
`;

export type WorkSheetLoad =
  | { status: "denied" }
  | { status: "not_found" }
  | {
      status: "ok";
      model: WorkSheetModel;
      /** N23: only whether the order has legacy notes, never their text. */
      legacyNotes: boolean;
    };

/** One loader for both profiles, replacing the order print loader of before E2 (contract §6). */
export const loadWorkSheet = cache(async function loadWorkSheet(
  id: string
): Promise<WorkSheetLoad> {
  const context = await getCurrentContext();
  if (!context) {
    return { status: "denied" };
  }

  if (!isUuid(id)) {
    return { status: "not_found" };
  }

  const tenantId = context.tenant.id;
  const supabase = await createClient();
  const [{ data: order, error }, features] = await Promise.all([
    supabase
      .from("orders")
      .select(WORK_SHEET_SELECT)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    // Server-side features only: no URL parameter or client value reaches this.
    loadOrderFeatures(supabase, tenantId),
  ]);

  if (error || !order) {
    return { status: "not_found" };
  }

  const source = order as unknown as WorkSheetSource;
  const profile = workSheetProfile(features);
  const hasStore = Boolean(source.store?.name?.trim());
  const [
    { data: settings },
    files,
    steps,
    notes,
    amounts,
    activeStoreCount,
    legacyNotes,
  ] = await Promise.all([
    supabase
      .from("tenant_settings")
      .select("business_name, branding, timezone")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    profile === "standard" ? loadOrderFileNames(supabase, tenantId, id) : Promise.resolve([]),
    features.workSequence ? loadWorkSheetSteps(supabase, tenantId, id) : Promise.resolve([]),
    features.stickyNotes ? loadPrintableNoteRows(supabase, tenantId, id) : Promise.resolve([]),
    profile === "ficha" ? loadCollectionAmounts(supabase, id) : Promise.resolve(null),
    profile === "ficha" && hasStore ? countActiveStores(supabase, tenantId) : Promise.resolve(0),
    hasLegacyNotes(supabase, tenantId, id),
  ]);

  const identity = publicOrganizationIdentity({
    businessName: settings?.business_name,
    tenantName: context.tenant.name,
    branding: settings?.branding,
  });

  return {
    status: "ok",
    legacyNotes,
    model: workSheetModel(source, {
      profile,
      features,
      branding: printBranding({
        displayName: identity.display_name,
        logoUrl: identity.logo_url,
        brandColor: identity.branding.brand_color,
      }),
      timeZone: resolveTimeZone(settings?.timezone),
      files,
      steps,
      notes,
      amounts,
      activeStoreCount,
      printedAt: new Date(),
    }),
  };
});
