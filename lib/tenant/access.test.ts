import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { accessLogRecord } from "@/lib/tenant/access-log";
import { accessFailureResponse } from "@/lib/tenant/access-http";
import {
  resolveCurrentAccess,
  sessionExpiredFailure,
  type AccessMembership,
  type AccessTenant,
  type AccessUser,
} from "@/lib/tenant/access";

const staff: AccessUser = {
  id: "user-raquel",
  email: "raquel@sur4.es",
  user_metadata: { full_name: "Raquel" },
};

const sur4: AccessTenant = {
  id: "tenant-sur4",
  name: "SUR4",
  slug: "sur4",
};

const membership: AccessMembership = { role: "staff", active: true };

function io(overrides: {
  user?: AccessUser | null;
  authError?: unknown;
  slug?: string | null;
  tenant?: AccessTenant | null;
  tenantError?: unknown;
  membership?: AccessMembership | null;
  membershipError?: unknown;
  throwAuth?: boolean;
}) {
  return {
    async getUser() {
      if (overrides.throwAuth) {
        throw overrides.authError ?? new Error("fetch failed");
      }
      return {
        user: overrides.user === undefined ? staff : overrides.user,
        error: overrides.authError ?? null,
      };
    },
    async resolveSlug() {
      return overrides.slug === undefined ? "sur4" : overrides.slug;
    },
    async loadTenant() {
      return {
        data: overrides.tenant === undefined ? sur4 : overrides.tenant,
        error: overrides.tenantError ?? null,
      };
    },
    async loadMembership() {
      return {
        data: overrides.membership === undefined ? membership : overrides.membership,
        error: overrides.membershipError ?? null,
      };
    },
  };
}

describe("resolveCurrentAccess", () => {
  it("returns the staff context when the session and membership are valid", async () => {
    const access = await resolveCurrentAccess(io({}));
    assert.equal(access.ok, true);
    if (!access.ok) return;
    assert.equal(access.context.membership.role, "staff");
    assert.equal(access.context.tenant.slug, "sur4");
    assert.equal(access.context.user.email, "raquel@sur4.es");
    assert.equal(access.context.user.full_name, "Raquel");
  });

  it("answers 401 when there is no session", async () => {
    const access = await resolveCurrentAccess(io({ user: null }));
    assert.equal(access.ok, false);
    if (access.ok) return;
    assert.deepEqual(access.failure, sessionExpiredFailure());
  });

  it("answers 401 when the refresh token is revoked and does not grant access", async () => {
    const access = await resolveCurrentAccess(
      io({
        user: null,
        authError: {
          name: "AuthApiError",
          status: 400,
          code: "refresh_token_not_found",
          message: "Invalid Refresh Token: Refresh Token Not Found",
        },
      })
    );
    assert.equal(access.ok, false);
    if (access.ok) return;
    assert.equal(access.failure.status, 401);
    assert.equal(access.failure.code, "SESSION_EXPIRED");
    assert.equal(access.failure.tenantSlug, null);
  });

  it("answers 401 when a rotated refresh token was already used", async () => {
    const access = await resolveCurrentAccess(
      io({
        user: null,
        authError: {
          name: "AuthApiError",
          status: 400,
          code: "refresh_token_already_used",
          message: "Invalid Refresh Token: Already Used",
        },
      })
    );
    assert.equal(access.ok, false);
    if (access.ok) return;
    assert.equal(access.failure.status, 401);
    assert.notEqual(access.failure.status, 403);
  });

  it("answers 403 for an inactive membership and a second refresh does not restore it", async () => {
    const denied = io({ membership: null });
    const first = await resolveCurrentAccess(denied);
    const second = await resolveCurrentAccess(denied);
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    if (first.ok || second.ok) return;
    assert.equal(first.failure.status, 403);
    assert.equal(first.failure.code, "TENANT_ACCESS_DENIED");
    assert.equal(first.failure.tenantSlug, "sur4");
    assert.equal(second.failure.status, 403);
  });

  it("answers 503 when Auth is unreachable instead of a permission denial", async () => {
    const access = await resolveCurrentAccess(
      io({
        user: null,
        authError: { name: "AuthRetryableFetchError", status: 503, message: "fetch failed" },
      })
    );
    assert.equal(access.ok, false);
    if (access.ok) return;
    assert.equal(access.failure.status, 503);
    assert.equal(access.failure.code, "AUTH_TEMPORARILY_UNAVAILABLE");
  });

  it("treats a discarded concurrent refresh as temporary, not as missing permission", async () => {
    const access = await resolveCurrentAccess(
      io({
        user: null,
        authError: { name: "AuthRefreshDiscardedError", message: "refresh discarded" },
      })
    );
    assert.equal(access.ok, false);
    if (access.ok) return;
    assert.equal(access.failure.status, 503);
  });

  it("answers 503 when the membership query fails transiently", async () => {
    const access = await resolveCurrentAccess(
      io({ membershipError: { code: "08006", message: "connection failure" } })
    );
    assert.equal(access.ok, false);
    if (access.ok) return;
    assert.equal(access.failure.status, 503);
    assert.equal(access.failure.tenantSlug, null);
  });

  it("does not treat an unknown Auth failure as an expired session", async () => {
    const access = await resolveCurrentAccess(
      io({ user: null, authError: { name: "AuthUnknownError", message: "something else" } })
    );
    assert.equal(access.ok, false);
    if (access.ok) return;
    assert.equal(access.failure.status, 503);
  });
});

describe("access diagnostics", () => {
  it("logs only the safe fields and omits the tenant until it is validated", () => {
    const record = accessLogRecord({
      route: "POST /api/orders",
      status: 401,
      category: "session_expired",
      tenantSlug: null,
      correlationId: "corr-1",
      at: "2026-10-13T08:00:00.000Z",
    });
    const serialized = JSON.stringify(record);
    assert.equal(record.event, "session_expired");
    assert.equal(record.route, "POST /api/orders");
    assert.equal("tenant" in record, false);
    assert.doesNotMatch(serialized, /jwt|refresh|cookie|password|authorization/i);

    const denied = accessLogRecord({
      route: "POST /api/orders",
      status: 403,
      category: "tenant_access_denied",
      tenantSlug: "sur4",
      correlationId: "corr-2",
      at: "2026-10-13T08:00:00.000Z",
    });
    assert.equal(denied.tenant, "sur4");
    assert.equal(denied.event, "tenant_access_denied");
  });

  it("returns a private JSON response with the public code", async () => {
    const logs: string[] = [];
    const original = console.error;
    console.error = (message?: unknown) => {
      logs.push(String(message));
    };
    try {
      const response = accessFailureResponse(sessionExpiredFailure(), "POST /api/orders");
      assert.equal(response.status, 401);
      assert.match(
        response.headers.get("Cache-Control") ?? "",
        /private, no-cache, no-store, must-revalidate, max-age=0/
      );
      assert.equal(response.headers.get("Pragma"), "no-cache");
      assert.equal(response.headers.get("Expires"), "0");
      const body = await response.json();
      assert.equal(body.code, "SESSION_EXPIRED");
      assert.equal(body.error, "Session expired");
      assert.equal(body.correlation_id, response.headers.get("X-Correlation-Id"));
      assert.equal(logs.length, 1);
      assert.match(logs[0], /"category":"session_expired"/);
      assert.doesNotMatch(logs[0], /Session expired|sur4/);
    } finally {
      console.error = original;
    }
  });
});
