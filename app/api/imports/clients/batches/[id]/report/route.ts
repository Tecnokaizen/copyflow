import { NextRequest, NextResponse } from "next/server";

import { OPERATIONAL_CACHE_CONTROL } from "@/lib/http/operational-cache";
import {
  clientImportForbidden,
  clientImportRpcError,
  isUuid,
  notFound,
} from "@/lib/imports/clients/http";
import { buildImportReportCsv, type ClientImportReportRow } from "@/lib/imports/clients/report";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

const ROUTE = "GET /api/imports/clients/batches/[id]/report";
const PAGE = 1000;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const rows: ClientImportReportRow[] = [];
  let fileName = "importacion";
  for (let offset = 0; offset < 10_000; offset += PAGE) {
    const { data, error } = await supabase.rpc("client_import_report", {
      p_batch_id: id,
      p_offset: offset,
      p_limit: PAGE,
    });
    if (error) return clientImportRpcError(ROUTE, access.context, error);
    const page = (data?.rows ?? []) as ClientImportReportRow[];
    fileName = typeof data?.file_name === "string" ? data.file_name : fileName;
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const safeName = fileName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "importacion";
  return new NextResponse(buildImportReportCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="informe-${safeName}.csv"`,
      "Cache-Control": OPERATIONAL_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
