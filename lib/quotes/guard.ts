import { operationalJson } from "@/lib/http/operational-cache";
import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { canAccessQuotesModule, QUOTES_FEATURE_CODE } from "@/lib/quotes/access";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function requireQuotesAccess() {
  const context = await getCurrentContext();

  if (!context) {
    return {
      ok: false as const,
      response: operationalJson(
        { error: QUOTE_MESSAGES.unauthorized },
        { status: 403 }
      ),
    };
  }

  const supabase = await createClient();
  const enabled = await tenantHasFeature(
    supabase,
    context.tenant.id,
    QUOTES_FEATURE_CODE
  );

  if (!canAccessQuotesModule(context.membership.role, enabled)) {
    return {
      ok: false as const,
      response: operationalJson(
        { error: enabled ? QUOTE_MESSAGES.unauthorized : QUOTE_MESSAGES.notFound },
        { status: enabled ? 403 : 404 }
      ),
    };
  }

  return {
    ok: true as const,
    context,
    supabase,
  };
}
