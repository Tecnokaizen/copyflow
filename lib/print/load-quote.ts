import "server-only";

import { cache } from "react";
import { printBranding } from "@/lib/print/order-document";
import { quotePrintModel, type QuotePrintClient } from "@/lib/print/quote-document";
import type { QuotePrintModel } from "@/lib/print/types";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { commercialStatus } from "@/lib/quotes/creation";
import { QUOTE_SELECT, mapQuote } from "@/lib/quotes/types";
import { publicOrganizationIdentity } from "@/lib/tenant/branding";
import { resolveTimeZone } from "@/lib/time/zoned-day";
import { isUuid } from "@/lib/team/payload";

export type QuotePrintLoad =
  | { status: "denied" }
  | { status: "not_found" }
  | { status: "ok"; model: QuotePrintModel };

export const loadQuotePrint = cache(async function loadQuotePrint(
  id: string
): Promise<QuotePrintLoad> {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response.status === 404
      ? { status: "not_found" }
      : { status: "denied" };
  }

  if (!isUuid(id)) {
    return { status: "not_found" };
  }

  const { data, error } = await access.supabase
    .from("quotes")
    .select(QUOTE_SELECT)
    .eq("id", id)
    .eq("tenant_id", access.context.tenant.id)
    .maybeSingle();

  if (error || !data) {
    return { status: "not_found" };
  }

  const quote = mapQuote(data);
  if (!quote) {
    return { status: "not_found" };
  }

  const clientId = quote.client?.id ?? null;
  const [{ data: clientRow }, { data: files }, { data: settings }] = await Promise.all([
    clientId
      ? access.supabase
          .from("clients")
          .select("name, company_name, contact_name, tax_id, email, phone")
          .eq("id", clientId)
          .eq("tenant_id", access.context.tenant.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    access.supabase
      .from("quote_files")
      .select("original_name, created_at")
      .eq("tenant_id", access.context.tenant.id)
      .eq("quote_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    access.supabase
      .from("tenant_settings")
      .select("business_name, branding, timezone")
      .eq("tenant_id", access.context.tenant.id)
      .maybeSingle(),
  ]);

  const client = (clientRow ?? null) as QuotePrintClient | null;
  const identity = publicOrganizationIdentity({
    businessName: settings?.business_name,
    tenantName: access.context.tenant.name,
    branding: settings?.branding,
  });

  return {
    status: "ok",
    model: quotePrintModel(
      {
        reference: quote.reference,
        title: quote.title,
        description: quote.description,
        notes: quote.notes,
        valid_until: quote.valid_until,
        created_at: quote.created_at,
        statusName: commercialStatus(quote).name,
        serviceName: quote.service?.name ?? null,
        assigneeName: quote.assignee?.name ?? null,
        convertedOrderReference: quote.converted_order?.reference ?? null,
        client: {
          name: client?.name ?? quote.client?.name ?? null,
          company_name: client?.company_name,
          contact_name: client?.contact_name,
          tax_id: client?.tax_id,
          email: client?.email,
          phone: client?.phone,
        },
      },
      {
        files: (files ?? []).map((file) => file.original_name),
        branding: printBranding({
          displayName: identity.display_name,
          logoUrl: identity.logo_url,
          brandColor: identity.branding.brand_color,
        }),
        timeZone: resolveTimeZone(settings?.timezone),
      }
    ),
  };
});
