import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { loadCustomerReceipt } from "@/lib/print/load-receipt";
import { loadReceiptLogo } from "@/lib/print/receipt-logo";
import { renderCustomerReceiptPdf } from "@/lib/print/receipt-pdf/render";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/team/payload";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

// SUR4 E4 (contract §6, N9): the customer receipt («Resguardo»), a PDF made on
// demand for any member of the order's tenant. Never stored in R2.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

function notFound() {
  return operationalJson({ error: "No se encontró el pedido" }, { status: 404 });
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const access = await requireCurrentAccess("GET /api/orders/[id]/receipt");
  if (!access.ok) return access.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  // The tenant comes from the session; an order of another tenant is a 404.
  const loaded = await loadCustomerReceipt(id, { supabase, tenant: access.context.tenant });
  if (loaded.status !== "ok") return notFound();

  let pdf: Buffer;
  try {
    pdf = await renderCustomerReceiptPdf(loaded.model, await loadReceiptLogo(loaded.logo));
  } catch {
    return operationalJson({ error: "No se pudo generar el resguardo. Puedes reintentar." }, { status: 503 });
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `inline; filename="${loaded.model.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
