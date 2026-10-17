import { NextRequest } from "next/server";

import { operationalJson } from "@/lib/http/operational-cache";
import {
  clientImportForbidden,
  clientImportRpcError,
  invalidBody,
  isUuid,
  notFound,
  readJsonBody,
} from "@/lib/imports/clients/http";
import { CLIENT_IMPORT_MAX_PAGE_SIZE, CLIENT_IMPORT_PAGE_SIZE, isRowFilter } from "@/lib/imports/clients/review";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

const ROUTE = "POST /api/imports/clients/batches/[id]/rows";
const ROUTE_GET = "GET /api/imports/clients/batches/[id]/rows";

/** Non-negative integer query parameter; null when present but not one. */
function intParam(value: string | null, fallback: number) {
  if (value === null || value === "") return fallback;
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}

/** Review: every row of the batch by filter, one page at a time (keyset on the row number). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCurrentAccess(ROUTE_GET);
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const search = request.nextUrl.searchParams;
  const filter = search.get("filter") ?? "attention";
  const after = intParam(search.get("after"), 0);
  const limit = intParam(search.get("limit"), CLIENT_IMPORT_PAGE_SIZE);
  if (!isRowFilter(filter) || after === null || limit === null || limit < 1 || limit > CLIENT_IMPORT_MAX_PAGE_SIZE) {
    return invalidBody();
  }

  const { data, error } = await supabase.rpc("client_import_rows_page", {
    p_batch_id: id,
    p_filter: filter,
    p_after_row: after,
    p_limit: limit,
  });
  if (error) return clientImportRpcError(ROUTE_GET, access.context, error);
  return operationalJson({ page: data });
}

/** Staging: one chunk of mapped rows. */

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJsonBody(request);
  const rows = body?.rows;
  if (
    !Array.isArray(rows) ||
    rows.length < 1 ||
    rows.length > 500 ||
    rows.some((row) => !row || typeof row !== "object" || !Number.isInteger((row as { row_number?: unknown }).row_number))
  ) {
    return invalidBody();
  }

  const { data, error } = await supabase.rpc("client_import_stage_rows", { p_batch_id: id, p_rows: rows });
  if (error) return clientImportRpcError(ROUTE, access.context, error);
  return operationalJson({ result: data });
}
