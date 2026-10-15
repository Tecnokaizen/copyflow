export const ACCESS_CODES = {
  sessionExpired: "SESSION_EXPIRED",
  tenantDenied: "TENANT_ACCESS_DENIED",
  unavailable: "AUTH_TEMPORARILY_UNAVAILABLE",
} as const;

export type AccessCode = (typeof ACCESS_CODES)[keyof typeof ACCESS_CODES];

export type AccessCategory =
  | "session_expired"
  | "tenant_access_denied"
  | "auth_temporarily_unavailable";

export type AccessFailure = {
  status: 401 | 403 | 503;
  code: AccessCode;
  category: AccessCategory;
  error: string;
  /** Present only after the tenant row for this host has been loaded. */
  tenantSlug: string | null;
};

export type AccessUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export type AccessTenant = {
  id: string;
  name: string;
  slug: string;
};

export type AccessMembership = {
  role: string;
  active: boolean;
};

export type AccessContext = {
  user: {
    id: string;
    email?: string;
    full_name?: string;
  };
  tenant: AccessTenant;
  membership: AccessMembership;
};

export type CurrentAccess =
  | { ok: true; context: AccessContext }
  | { ok: false; failure: AccessFailure };

const SESSION_CODES = new Set([
  "session_expired",
  "session_not_found",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "bad_jwt",
]);

const TEMPORARY_CODES = new Set([
  "request_timeout",
  "over_request_rate_limit",
  "unexpected_failure",
  "hook_timeout",
  "hook_timeout_after_retry",
]);

const TEMPORARY_NAMES = new Set([
  "AuthRetryableFetchError",
  "AuthRefreshDiscardedError",
]);

const SESSION_NAMES = new Set([
  "AuthSessionMissingError",
  "AuthInvalidJwtError",
  "AuthApiError",
]);

const TRANSIENT_DB_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "40001",
  "40P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "57014",
  "PGRST000",
  "PGRST001",
  "PGRST002",
  "PGRST003",
  "PGRST301",
]);

const DEFINITE_DENIAL_CODES = new Set(["42501", "PGRST116"]);

export function sessionExpiredFailure(): AccessFailure {
  return {
    status: 401,
    code: ACCESS_CODES.sessionExpired,
    category: "session_expired",
    error: "Session expired",
    tenantSlug: null,
  };
}

export function tenantDeniedFailure(tenantSlug: string | null): AccessFailure {
  return {
    status: 403,
    code: ACCESS_CODES.tenantDenied,
    category: "tenant_access_denied",
    error: "Unauthorized or tenant access denied",
    tenantSlug,
  };
}

export function unavailableFailure(): AccessFailure {
  return {
    status: 503,
    code: ACCESS_CODES.unavailable,
    category: "auth_temporarily_unavailable",
    error: "Authentication temporarily unavailable",
    tenantSlug: null,
  };
}

function readString(error: object, key: string) {
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStatus(error: object) {
  const value = (error as Record<string, unknown>).status;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isNetworkMessage(message: string) {
  return /fetch failed|failed to fetch|network|econnreset|econnrefused|etimedout|enotfound|socket hang up|timeout/i.test(
    message
  );
}

/**
 * Classifies an Auth error without treating every failure as a dead session.
 * AuthRefreshDiscardedError is a concurrent refresh/sign-out race: the caller
 * should retry, not tell the worker they lack permission.
 */
export function classifyAuthError(
  error: unknown
): "session_expired" | "auth_temporarily_unavailable" | "unknown" {
  if (!error || typeof error !== "object") {
    return "unknown";
  }

  const name = readString(error, "name");
  const code = readString(error, "code");
  const message = readString(error, "message") ?? "";
  const status = readStatus(error);

  if (name && TEMPORARY_NAMES.has(name)) {
    return "auth_temporarily_unavailable";
  }
  if (code && TEMPORARY_CODES.has(code)) {
    return "auth_temporarily_unavailable";
  }
  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    return "auth_temporarily_unavailable";
  }
  if (isNetworkMessage(message)) {
    return "auth_temporarily_unavailable";
  }
  if (code && SESSION_CODES.has(code)) {
    return "session_expired";
  }
  if (
    (status === 400 || status === 401) &&
    /refresh token|invalid claim|jwt expired/i.test(message)
  ) {
    return "session_expired";
  }
  if ((name && SESSION_NAMES.has(name) && name !== "AuthApiError") || status === 401) {
    return "session_expired";
  }
  if (name === "AuthApiError" && (status === 401 || status === 403)) {
    return "session_expired";
  }

  return "unknown";
}

export function classifyQueryError(
  error: unknown
): "auth_temporarily_unavailable" | "tenant_access_denied" {
  if (!error || typeof error !== "object") {
    return "auth_temporarily_unavailable";
  }

  const code = readString(error, "code");
  const message = readString(error, "message") ?? "";
  const status = readStatus(error);

  if (code && TRANSIENT_DB_CODES.has(code)) {
    return "auth_temporarily_unavailable";
  }
  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    return "auth_temporarily_unavailable";
  }
  if (isNetworkMessage(message)) {
    return "auth_temporarily_unavailable";
  }
  if (code && DEFINITE_DENIAL_CODES.has(code)) {
    return "tenant_access_denied";
  }

  return "auth_temporarily_unavailable";
}

function displayName(user: AccessUser) {
  const metadata = user.user_metadata ?? {};
  if (typeof metadata.full_name === "string" && metadata.full_name.trim()) {
    return metadata.full_name.trim();
  }
  if (typeof metadata.name === "string" && metadata.name.trim()) {
    return metadata.name.trim();
  }
  return null;
}

export function accessContext(input: {
  user: AccessUser;
  tenant: AccessTenant;
  membership: AccessMembership;
}): AccessContext {
  const fullName = displayName(input.user);
  return {
    user: {
      id: input.user.id,
      email: input.user.email ?? undefined,
      ...(fullName ? { full_name: fullName } : {}),
    },
    tenant: input.tenant,
    membership: {
      role: input.membership.role,
      active: input.membership.active,
    },
  };
}

type QueryResult<T> = { data: T | null; error: unknown };

export async function resolveCurrentAccess(io: {
  getUser: () => Promise<{ user: AccessUser | null; error: unknown }>;
  resolveSlug: () => Promise<string | null>;
  loadTenant: (slug: string) => Promise<QueryResult<AccessTenant>>;
  loadMembership: (
    userId: string,
    tenantId: string
  ) => Promise<QueryResult<AccessMembership>>;
}): Promise<CurrentAccess> {
  let userResult: { user: AccessUser | null; error: unknown };
  try {
    userResult = await io.getUser();
  } catch (error) {
    const kind = classifyAuthError(error);
    if (kind === "session_expired") {
      return { ok: false, failure: sessionExpiredFailure() };
    }
    return { ok: false, failure: unavailableFailure() };
  }

  const authKind = userResult.error ? classifyAuthError(userResult.error) : null;
  if (!userResult.user) {
    if (authKind === "auth_temporarily_unavailable" || authKind === "unknown" && userResult.error) {
      return { ok: false, failure: unavailableFailure() };
    }
    return { ok: false, failure: sessionExpiredFailure() };
  }

  if (authKind === "auth_temporarily_unavailable") {
    return { ok: false, failure: unavailableFailure() };
  }

  let slug: string | null;
  try {
    slug = await io.resolveSlug();
  } catch {
    return { ok: false, failure: unavailableFailure() };
  }

  if (!slug) {
    return { ok: false, failure: tenantDeniedFailure(null) };
  }

  let tenantResult: QueryResult<AccessTenant>;
  try {
    tenantResult = await io.loadTenant(slug);
  } catch {
    return { ok: false, failure: unavailableFailure() };
  }

  if (tenantResult.error) {
    const kind = classifyQueryError(tenantResult.error);
    return {
      ok: false,
      failure: kind === "tenant_access_denied" ? tenantDeniedFailure(null) : unavailableFailure(),
    };
  }

  if (!tenantResult.data) {
    return { ok: false, failure: tenantDeniedFailure(null) };
  }

  const tenant = tenantResult.data;

  let membershipResult: QueryResult<AccessMembership>;
  try {
    membershipResult = await io.loadMembership(userResult.user.id, tenant.id);
  } catch {
    return { ok: false, failure: unavailableFailure() };
  }

  if (membershipResult.error) {
    const kind = classifyQueryError(membershipResult.error);
    return {
      ok: false,
      failure:
        kind === "tenant_access_denied"
          ? tenantDeniedFailure(tenant.slug)
          : unavailableFailure(),
    };
  }

  if (!membershipResult.data || membershipResult.data.active !== true) {
    return { ok: false, failure: tenantDeniedFailure(tenant.slug) };
  }

  return {
    ok: true,
    context: accessContext({
      user: userResult.user,
      tenant,
      membership: membershipResult.data,
    }),
  };
}
