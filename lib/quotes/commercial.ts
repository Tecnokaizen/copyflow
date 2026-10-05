import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { mapQuoteVersion, type QuoteVersion } from "@/lib/quotes/types";

export type CommercialRpcBody = {
  ok?: boolean;
  created?: boolean;
  error?: string;
  row_version?: unknown;
  version?: unknown;
};

export type CommercialRpcSuccess = {
  ok: true;
  created: boolean;
  version: QuoteVersion;
};

export type CommercialRpcFailure = {
  ok: false;
  status: 400 | 404 | 409 | 422 | 500;
  error: string;
  code: string;
  currentRowVersion?: number;
};

export function commercialFailureBody(failure: CommercialRpcFailure) {
  return {
    error: failure.error,
    code: failure.code,
    ...(failure.currentRowVersion === undefined
      ? {}
      : { current_row_version: failure.currentRowVersion }),
  };
}

function rowVersion(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function interpretCommercialRpcResult(
  body: CommercialRpcBody
): CommercialRpcSuccess | CommercialRpcFailure {
  if (body.ok === true) {
    const version = mapQuoteVersion(body.version);
    if (!version) {
      return {
        ok: false,
        status: 500,
        error: QUOTE_MESSAGES.commercialLoad,
        code: "invalid_rpc_result",
      };
    }

    return {
      ok: true,
      created: body.created === true,
      version,
    };
  }

  switch (body.error) {
    case "invalid":
      return { ok: false, status: 400, error: QUOTE_MESSAGES.invalid, code: "invalid" };
    case "not_found":
      return { ok: false, status: 404, error: QUOTE_MESSAGES.notFound, code: "not_found" };
    case "conflict": {
      const currentRowVersion = rowVersion(body.row_version);
      return {
        ok: false,
        status: 409,
        error: QUOTE_MESSAGES.version,
        code: "stale_row_version",
        ...(currentRowVersion === null ? {} : { currentRowVersion }),
      };
    }
    case "immutable_version":
      return {
        ok: false,
        status: 409,
        error: QUOTE_MESSAGES.immutableVersion,
        code: "immutable_version",
      };
    case "draft_exists":
      return {
        ok: false,
        status: 409,
        error: QUOTE_MESSAGES.draftExists,
        code: "draft_exists",
      };
    case "new_version_required":
      return {
        ok: false,
        status: 409,
        error: QUOTE_MESSAGES.newVersionRequired,
        code: "new_version_required",
      };
    case "items_required":
      return {
        ok: false,
        status: 422,
        error: QUOTE_MESSAGES.itemsRequired,
        code: "items_required",
      };
    case "history_required":
      return {
        ok: false,
        status: 422,
        error: QUOTE_MESSAGES.historyRequired,
        code: "history_required",
      };
    default:
      return {
        ok: false,
        status: 500,
        error: QUOTE_MESSAGES.commercialLoad,
        code: "rpc_error",
      };
  }
}

export type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
};

export function interpretCommercialDatabaseError(
  error: PostgrestErrorLike | null | undefined,
  fallback: string
): CommercialRpcFailure {
  const code = error?.code ?? "database_error";
  if (code === "23503") {
    return { ok: false, status: 404, error: QUOTE_MESSAGES.notFound, code: "not_found" };
  }
  if (code === "42501") {
    return { ok: false, status: 404, error: QUOTE_MESSAGES.notFound, code: "not_found" };
  }
  if (code === "55000") {
    return {
      ok: false,
      status: 409,
      error: QUOTE_MESSAGES.immutableVersion,
      code: "immutable_version",
    };
  }
  if (code === "23514" || code.startsWith("22")) {
    return { ok: false, status: 422, error: QUOTE_MESSAGES.invalid, code: "business_invariant" };
  }

  return { ok: false, status: 500, error: fallback, code: "database_error" };
}

// RPC authorization allows every membership; HTTP additionally binds the quote
// to the tenant selected by the request host, including multi-membership users.
export async function commercialQuoteInTenant(
  supabase: { from: (table: string) => unknown },
  quoteId: string,
  tenantId: string
): Promise<CommercialRpcFailure | null> {
  const query = supabase.from("quotes") as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => PromiseLike<{ data: unknown; error: PostgrestErrorLike | null }>;
        };
      };
    };
  };
  const { data, error } = await query.select("id")
    .eq("id", quoteId).eq("tenant_id", tenantId).maybeSingle();
  if (error) return interpretCommercialDatabaseError(error, QUOTE_MESSAGES.commercialLoad);
  return data ? null : {
    ok: false, status: 404, error: QUOTE_MESSAGES.notFound, code: "not_found",
  };
}
