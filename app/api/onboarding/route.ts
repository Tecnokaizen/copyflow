import { NextRequest, NextResponse } from "next/server";

import {
  CHECKOUT_PROCESSING_CODE,
  CheckoutConflictError,
  CheckoutProcessingError,
  CheckoutTransientError,
  CURRENT_SUBSCRIPTION_EXISTS_CODE,
  appHostOriginFromRequest,
  createCheckoutSessionForTenant,
} from "@/lib/billing/checkout";
import {
  assertStripeConfig,
  stripeModeToLivemode,
} from "@/lib/billing/stripe-config";
import { mapOnboardingPostgresError } from "@/lib/onboarding/errors";
import {
  ONBOARDING_PENDING_CODES,
  resolvePendingCommercialTenant,
} from "@/lib/onboarding/pending-tenant";
import { createClient } from "@/lib/supabase/server";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

const DEFAULT_TIMEZONE = "Europe/Madrid";
const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function checkoutErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof CheckoutConflictError) {
    return json(
      {
        error: "Current subscription already exists",
        code: CURRENT_SUBSCRIPTION_EXISTS_CODE,
      },
      409
    );
  }
  if (error instanceof CheckoutProcessingError) {
    return json(
      {
        error: "Checkout completed; subscription confirmation in progress",
        code: CHECKOUT_PROCESSING_CODE,
      },
      409
    );
  }
  if (error instanceof CheckoutTransientError) {
    return json(
      {
        error: "Checkout temporarily unavailable",
        code: "checkout_transient",
      },
      503
    );
  }
  return null;
}

function emptyToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOnboardingPayload(payload: unknown):
  | { ok: true; name: string; slug: string; timezone: string }
  | { ok: false } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false };
  }

  const record = payload as Record<string, unknown>;
  const allowedKeys = new Set(["name", "slug", "timezone"]);

  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return { ok: false };
  }

  const name = emptyToNull(record.name);
  const slug = emptyToNull(record.slug);

  if (!name || !slug) {
    return { ok: false };
  }

  if (record.timezone != null && typeof record.timezone !== "string") {
    return { ok: false };
  }

  const timezone = emptyToNull(record.timezone) ?? DEFAULT_TIMEZONE;

  return { ok: true, name, slug, timezone };
}

function isTenantHostFromRequest(request: NextRequest) {
  const hostname =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "";
  return getSubdomainFromHostname(hostname) !== null;
}

async function startOnboardingCheckout(input: {
  request: NextRequest;
  tenantId: string;
  tenantSlug: string;
  customerEmail?: string | null;
}): Promise<{ url: string; sessionId: string }> {
  const origin = appHostOriginFromRequest(input.request);

  return createCheckoutSessionForTenant({
    request: input.request,
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    planCode: "basic",
    billingInterval: "month",
    customerEmail: input.customerEmail,
    successUrl: `${origin}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/onboarding?canceled=1`,
    flow: "onboarding",
  });
}

export async function GET(request: NextRequest) {
  if (isTenantHostFromRequest(request)) {
    return json(
      { error: "Onboarding is only available on the app host" },
      403
    );
  }

  const stripeConfig = assertStripeConfig();
  if (!stripeConfig.ok) {
    return json({ error: "Billing is not configured" }, 503);
  }
  const expectedLivemode = stripeModeToLivemode(stripeConfig.mode);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const pending = await resolvePendingCommercialTenant(
      supabase,
      user.id,
      expectedLivemode
    );
    if (!pending.ok) {
      if (pending.code === ONBOARDING_PENDING_CODES.AMBIGUOUS_PENDING_TENANT) {
        return json(
          {
            error: "Ambiguous pending onboarding tenants",
            code: pending.code,
          },
          409
        );
      }
      return json({ pending: null }, 200);
    }

    return json(
      {
        pending: {
          tenant: {
            id: pending.tenant.id,
            slug: pending.tenant.slug,
            name: pending.tenant.name,
          },
        },
      },
      200
    );
  } catch (error) {
    console.error("[GET /api/onboarding] pending lookup failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "Could not load onboarding state" }, 500);
  }
}

export async function POST(request: NextRequest) {
  if (isTenantHostFromRequest(request)) {
    return json(
      { error: "Onboarding is only available on the app host" },
      403
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const stripeConfig = assertStripeConfig();
  if (!stripeConfig.ok) {
    return json({ error: "Billing is not configured" }, 503);
  }
  const expectedLivemode = stripeModeToLivemode(stripeConfig.mode);

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  // Resume payment for an existing pending tenant (no tenant_id from browser).
  if (record.resume === true) {
    if (Object.keys(record).some((key) => key !== "resume")) {
      return json({ error: "Invalid value" }, 400);
    }

    try {
      const pending = await resolvePendingCommercialTenant(
        supabase,
        user.id,
        expectedLivemode
      );
      if (!pending.ok) {
        if (pending.code === ONBOARDING_PENDING_CODES.AMBIGUOUS_PENDING_TENANT) {
          return json(
            {
              error: "Ambiguous pending onboarding tenants",
              code: pending.code,
            },
            409
          );
        }
        return json(
          { error: "No pending onboarding tenant", code: pending.code },
          404
        );
      }

      const session = await startOnboardingCheckout({
        request,
        tenantId: pending.tenant.id,
        tenantSlug: pending.tenant.slug,
        customerEmail: user.email,
      });

      return json(
        {
          ok: true,
          resumed: true,
          checkout_url: session.url,
          session_id: session.sessionId,
          tenant: {
            id: pending.tenant.id,
            slug: pending.tenant.slug,
            name: pending.tenant.name,
          },
        },
        200
      );
    } catch (error) {
      const mapped = checkoutErrorResponse(error);
      if (mapped) {
        return mapped;
      }
      console.error("[POST /api/onboarding] resume checkout failed", {
        userId: user.id,
        message: error instanceof Error ? error.message : "unknown",
      });
      return json({ error: "Could not create checkout session" }, 500);
    }
  }

  const parsed = parseOnboardingPayload(body);

  if (!parsed.ok) {
    return json({ error: "Invalid value" }, 400);
  }

  const { data, error } = await supabase.rpc("create_organization", {
    p_name: parsed.name,
    p_slug: parsed.slug,
    p_timezone: parsed.timezone,
  });

  if (error || !data) {
    // Organization limit: try resume path instead of trapping the user.
    if (error?.code === "54000") {
      try {
        const pending = await resolvePendingCommercialTenant(
          supabase,
          user.id,
          expectedLivemode
        );
        if (pending.ok) {
          const session = await startOnboardingCheckout({
            request,
            tenantId: pending.tenant.id,
            tenantSlug: pending.tenant.slug,
            customerEmail: user.email,
          });

          return json(
            {
              ok: true,
              resumed: true,
              checkout_url: session.url,
              session_id: session.sessionId,
              tenant: {
                id: pending.tenant.id,
                slug: pending.tenant.slug,
                name: pending.tenant.name,
              },
            },
            200
          );
        }
      } catch (resumeError) {
        const mapped = checkoutErrorResponse(resumeError);
        if (mapped) {
          return mapped;
        }
        console.error("[POST /api/onboarding] auto-resume failed", {
          userId: user.id,
          message:
            resumeError instanceof Error ? resumeError.message : "unknown",
        });
      }
    }

    const mapped = mapOnboardingPostgresError(error?.code);

    console.error("[POST /api/onboarding] Could not create organization", {
      userId: user.id,
      error,
      code: mapped.code,
    });

    return json(
      mapped.code
        ? { error: mapped.error, code: mapped.code }
        : { error: mapped.error },
      mapped.status
    );
  }

  const recordResult =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  const tenantId =
    typeof recordResult.tenant_id === "string" ? recordResult.tenant_id : null;
  const slug = typeof recordResult.slug === "string" ? recordResult.slug : null;
  const name = typeof recordResult.name === "string" ? recordResult.name : null;

  if (!tenantId || !slug || !name) {
    console.error("[POST /api/onboarding] Invalid RPC payload", {
      userId: user.id,
    });

    return json({ error: "Could not create organization" }, 500);
  }

  try {
    const session = await startOnboardingCheckout({
      request,
      tenantId,
      tenantSlug: slug,
      customerEmail: user.email,
    });

    return json(
      {
        ok: true,
        checkout_url: session.url,
        session_id: session.sessionId,
        tenant: {
          id: tenantId,
          slug,
          name,
        },
      },
      201
    );
  } catch (checkoutError) {
    if (checkoutError instanceof CheckoutConflictError) {
      return json(
        {
          error: "Current subscription already exists",
          code: CURRENT_SUBSCRIPTION_EXISTS_CODE,
          tenant: {
            id: tenantId,
            slug,
            name,
          },
        },
        409
      );
    }
    if (checkoutError instanceof CheckoutProcessingError) {
      return json(
        {
          error: "Checkout completed; subscription confirmation in progress",
          code: CHECKOUT_PROCESSING_CODE,
          tenant: {
            id: tenantId,
            slug,
            name,
          },
        },
        409
      );
    }
    if (checkoutError instanceof CheckoutTransientError) {
      return json(
        {
          ok: true,
          checkout_pending: true,
          code: "checkout_transient",
          error: "Checkout temporarily unavailable",
          tenant: {
            id: tenantId,
            slug,
            name,
          },
        },
        201
      );
    }
    console.error("[POST /api/onboarding] checkout after create failed", {
      userId: user.id,
      tenantId,
      message:
        checkoutError instanceof Error ? checkoutError.message : "unknown",
    });

    // Tenant exists pending; client can resume. Do not delete.
    return json(
      {
        ok: true,
        checkout_pending: true,
        code: "checkout_creation_failed",
        error: "Organization created but checkout could not start",
        tenant: {
          id: tenantId,
          slug,
          name,
        },
      },
      201
    );
  }
}
