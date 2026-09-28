import "server-only";

import { NextResponse } from "next/server";
import { loadTenantEntitlement } from "@/lib/billing/entitlement-access";
import type { Entitlement } from "@/lib/billing/entitlement";
import { SUBSCRIPTION_REQUIRED_BODY } from "@/lib/billing/entitlement-paths";
import { getCurrentContext } from "@/lib/tenant/current-context";

export function subscriptionRequiredResponse() {
  return NextResponse.json(
    SUBSCRIPTION_REQUIRED_BODY,
    {
      status: 402,
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    }
  );
}

export type OperationalContext =
  | {
      kind: "unauthorized";
    }
  | {
      kind: "subscription_required";
      context: NonNullable<Awaited<ReturnType<typeof getCurrentContext>>>;
      entitlement: Entitlement;
    }
  | {
      kind: "entitled";
      context: NonNullable<Awaited<ReturnType<typeof getCurrentContext>>>;
      entitlement: Entitlement;
    };

/**
 * Identity comes from getCurrentContext(). Commercial access is a second step
 * and never overloads tenants.active.
 */
export async function getCurrentOperationalContext(): Promise<OperationalContext> {
  const context = await getCurrentContext();
  if (!context) {
    return { kind: "unauthorized" };
  }

  let entitlement: Entitlement;
  try {
    entitlement = await loadTenantEntitlement(context.tenant.id);
  } catch (error) {
    console.error("[entitlement] could not resolve subscription", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return {
      kind: "subscription_required",
      context,
      entitlement: {
        allowed: false,
        source: "none",
        status: null,
        planCode: null,
        reason: "no_current_subscription",
      },
    };
  }

  if (!entitlement.allowed) {
    return { kind: "subscription_required", context, entitlement };
  }

  return { kind: "entitled", context, entitlement };
}
