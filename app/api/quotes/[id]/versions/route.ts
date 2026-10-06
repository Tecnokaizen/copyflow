import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import {
  commercialFailureBody,
  commercialQuoteInTenant,
  interpretCommercialDatabaseError,
  interpretCommercialRpcResult,
} from "@/lib/quotes/commercial";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { QUOTE_VERSION_SELECT, mapQuoteVersion } from "@/lib/quotes/types";
import { isUuid } from "@/lib/team/payload";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }

  const scopeFailure = await commercialQuoteInTenant(
    access.supabase, id, access.context.tenant.id
  );
  if (scopeFailure) {
    return operationalJson(commercialFailureBody(scopeFailure), { status: scopeFailure.status });
  }

  const { data, error } = await access.supabase.rpc("create_quote_version_v1", {
    p_quote_id: id,
  });
  if (error) {
    const failure = interpretCommercialDatabaseError(error, QUOTE_MESSAGES.newVersion);
    return operationalJson(commercialFailureBody(failure), { status: failure.status });
  }

  const result = interpretCommercialRpcResult(
    (data ?? {}) as { ok?: boolean; error?: string; version?: unknown }
  );
  if (!result.ok && result.code === "draft_exists") {
    const { data: draft, error: draftError } = await access.supabase
      .from("quote_versions")
      .select(QUOTE_VERSION_SELECT)
      .eq("tenant_id", access.context.tenant.id)
      .eq("quote_id", id)
      .eq("state", "draft")
      .maybeSingle();
    const version = mapQuoteVersion(draft);
    if (!draftError && version) {
      return operationalJson({
        ok: true,
        tenant: access.context.tenant.slug,
        created: false,
        replayed: true,
        version,
      });
    }
  }

  if (!result.ok) {
    return operationalJson(commercialFailureBody(result), { status: result.status });
  }

  return operationalJson(
    {
      ok: true,
      tenant: access.context.tenant.slug,
      created: true,
      replayed: false,
      version: result.version,
    },
    { status: 201 }
  );
}
