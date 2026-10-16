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
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

const ROUTE = "POST /api/imports/clients/batches/[id]/rows";

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
