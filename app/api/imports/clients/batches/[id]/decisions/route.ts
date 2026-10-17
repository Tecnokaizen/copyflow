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
import { isRowDecision } from "@/lib/imports/clients/review";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

const ROUTE = "POST /api/imports/clients/batches/[id]/decisions";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJsonBody(request);
  const rowNumbers = body?.row_numbers;
  if (
    !body ||
    !Array.isArray(rowNumbers) ||
    rowNumbers.length < 1 ||
    rowNumbers.length > 10_000 ||
    !rowNumbers.every((value) => Number.isInteger(value)) ||
    !isRowDecision(body.decision)
  ) {
    return invalidBody();
  }

  const { data, error } = await supabase.rpc("client_import_set_row_decisions", { p_batch_id: id, p_row_numbers: rowNumbers, p_decision: body.decision });
  if (error) return clientImportRpcError(ROUTE, access.context, error);
  return operationalJson({ batch: data });
}
