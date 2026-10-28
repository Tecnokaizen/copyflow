// SUR4 E2/E4: the reads of the printed documents besides the order row. Each
// one is a closed select bound to the session tenant; they take the client as
// a parameter so tests can check every filter with a fake.
import type { SupabaseClient } from "@supabase/supabase-js";

import { isRichTextEmpty } from "@/lib/rich-text/html";
import {
  collectionAmounts,
  type CollectionAmounts,
  type WorkSheetNoteRow,
  type WorkSheetStepRow,
} from "@/lib/print/work-sheet-rules";

// order_work_steps has two foreign keys towards team_members: every embed
// names its constraint (E1, lib/orders/postgrest-hints.test.ts).
export const WORK_SHEET_STEP_SELECT = [
  "position",
  "completed_at",
  "is_current",
  "stage:work_stages!order_work_steps_stage_fk(name, icon)",
  "team_member:team_members!order_work_steps_team_member_fk(name)",
  "executed_by:team_members!order_work_steps_executed_by_fk(name)",
].join(", ");

// Only what a printable post-it needs. No author, reasons or versions.
export const WORK_SHEET_NOTE_SELECT = "body, visibility, state, redacted_at";

/**
 * N23: whether the order has legacy notes (orders.notes). Separate read: the
 * text never leaves this function, only the boolean does.
 */
export async function hasLegacyNotes(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("orders")
    .select("notes")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return false;
  return !isRichTextEmpty((data as { notes?: string | null }).notes);
}

/** Standard profile: every non-deleted file, as the print of today. */
export async function loadOrderFileNames(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("order_files")
    .select("original_name, created_at")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Array<{ original_name?: string | null }>).map(
    (file) => file.original_name ?? ""
  );
}

/** Only with order_work_sequence (RLS answers no rows without it anyway). */
export async function loadWorkSheetSteps(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<WorkSheetStepRow[]> {
  const { data, error } = await supabase
    .from("order_work_steps")
    .select(WORK_SHEET_STEP_SELECT)
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .order("position", { ascending: true });
  if (error) return [];
  return (data ?? []) as WorkSheetStepRow[];
}

/**
 * Only with order_sticky_notes. The query asks order_notes for printable,
 * not voided and not suppressed notes only: internal ones never leave the
 * database for the work sheet.
 */
export async function loadPrintableNoteRows(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<WorkSheetNoteRow[]> {
  const { data, error } = await supabase
    .from("order_notes")
    .select(WORK_SHEET_NOTE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .eq("visibility", "printable")
    .neq("state", "voided")
    .not("body", "is", null)
    .is("redacted_at", null)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as WorkSheetNoteRow[];
}

/** N20: active stores of the tenant, counted without reading any row. */
export async function countActiveStores(
  supabase: SupabaseClient,
  tenantId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("stores")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) return 0;
  return typeof count === "number" ? count : 0;
}

/** The three amounts, from order_collection_v1 like the order page (N11). */
export async function loadCollectionAmounts(
  supabase: SupabaseClient,
  orderId: string
): Promise<CollectionAmounts | null> {
  const { data, error } = await supabase.rpc("order_collection_v1", {
    p_order_id: orderId,
  });
  if (error) return null;
  return collectionAmounts(data);
}
