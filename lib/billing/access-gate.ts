/**
 * Billing Access Gate V1 · pure decision logic (no I/O).
 *
 * The commercial state is computed in SQL
 * (`current_tenant_billing_access_v1`); this module decides what the proxy
 * does with it. The database trigger is the hard backstop for writes; the
 * proxy gives users a clear page and API callers a clear 402.
 */

export const BILLING_SUSPENDED_PATH = "/billing-suspended";
export const BILLING_SUSPENDED_CODE = "billing_suspended";

export type BillingGateMode = "off" | "observe" | "enforce";

export type BillingAccessState =
  | "exempt"
  | "subscription_active"
  | "subscription_canceling"
  | "past_due_grace"
  | "trial_active"
  | "internal_active"
  | "reconciliation_pending"
  | "checkout_pending"
  | "past_due_suspended"
  | "trial_expired"
  | "internal_expired"
  | "subscription_ended"
  | "no_subscription";

export type MemberBillingAccess = {
  allowed: boolean;
  enforced: boolean;
  mode: BillingGateMode;
  state: BillingAccessState | string;
  role: string | null;
  graceUntil: string | null;
  pendingUntil: string | null;
  periodEnd: string | null;
};

/** Parse the RPC payload; anything unexpected is null (no decision). */
export function parseMemberBillingAccess(value: unknown): MemberBillingAccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.allowed !== "boolean" || typeof record.state !== "string") {
    return null;
  }
  const mode =
    record.mode === "observe" || record.mode === "enforce" ? record.mode : "off";
  const text = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  return {
    allowed: record.allowed,
    enforced: record.enforced === true && mode === "enforce",
    mode,
    state: record.state,
    role: text("role"),
    graceUntil: text("grace_until"),
    pendingUntil: text("pending_until"),
    periodEnd: text("period_end"),
  };
}

/**
 * Paths that always work for a suspended tenant: authentication, billing
 * (consult, Checkout, Portal, return pages), Stripe webhooks, internal
 * signed jobs, help/support, invitations, and the suspension page itself.
 * Kiosk paths are left to the database trigger (anon writes are blocked there).
 */
export function isBillingGateExemptPath(pathname: string): boolean {
  const exact = new Set([
    BILLING_SUSPENDED_PATH,
    "/tenant-inactive",
    "/ayuda",
    "/settings/billing",
    "/kiosk",
  ]);
  if (exact.has(pathname)) {
    return true;
  }
  const prefixes = [
    `${BILLING_SUSPENDED_PATH}/`,
    "/auth/",
    "/api/auth/",
    "/api/billing/",
    "/api/webhooks/",
    "/api/internal/",
    "/api/kiosk/",
    "/settings/billing/",
    "/tenant-inactive/",
    "/ayuda/",
    "/invitations/",
    "/kiosk/",
  ];
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

/**
 * The proxy reads the gate only when BILLING_ACCESS_GATE_PROXY=on. Off by
 * default: deploying this code adds no request work until it is enabled.
 * The SQL mode (off/observe/enforce) still decides what happens.
 */
export function isBillingGateProxyEnabled(
  env: Record<string, string | undefined>
): boolean {
  return env.BILLING_ACCESS_GATE_PROXY === "on";
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type BillingGateDecision =
  | { action: "pass" }
  | { action: "observe"; wouldBlock: "redirect" | "block"; state: string }
  | { action: "redirect"; state: string }
  | { action: "block"; state: string };

/**
 * - Page navigations of a suspended tenant → suspension page.
 * - API mutations (POST/PUT/PATCH/DELETE) → 402 billing_suspended.
 * - API reads pass (data stays available; the UI is already redirected).
 * - observe: never blocks, reports what enforce would do.
 * - No answer (null: non-member, RPC failure) → pass; RLS and the DB
 *   trigger still apply.
 */
export function decideBillingGate(input: {
  access: MemberBillingAccess | null;
  pathname: string;
  method: string;
}): BillingGateDecision {
  const { access, pathname } = input;
  if (!access || access.allowed || access.mode === "off") {
    return { action: "pass" };
  }
  if (isBillingGateExemptPath(pathname)) {
    return { action: "pass" };
  }

  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const method = input.method.toUpperCase();
  let outcome: "redirect" | "block" | null = null;
  if (isApi) {
    outcome = SAFE_METHODS.has(method) ? null : "block";
  } else if (SAFE_METHODS.has(method)) {
    outcome = "redirect";
  } else {
    outcome = "block";
  }

  if (!outcome) {
    return { action: "pass" };
  }
  if (!access.enforced) {
    return { action: "observe", wouldBlock: outcome, state: access.state };
  }
  return outcome === "redirect"
    ? { action: "redirect", state: access.state }
    : { action: "block", state: access.state };
}

/** Spanish copy for the suspension page, by state. */
export function billingSuspensionMessage(state: string): string {
  switch (state) {
    case "trial_expired":
    case "internal_expired":
      return "El periodo de prueba de este espacio ha terminado y todavía no hay una suscripción contratada.";
    case "past_due_suspended":
      return "No hemos podido cobrar la suscripción y el plazo de gracia ha terminado.";
    case "subscription_ended":
      return "La suscripción de este espacio ha finalizado.";
    case "no_subscription":
      return "Este espacio no tiene una suscripción activa.";
    default:
      return "La operativa de este espacio está suspendida por su estado de facturación.";
  }
}
