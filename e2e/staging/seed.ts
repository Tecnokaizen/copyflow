/**
 * Idempotent provisioning of the synthetic `e2e` tenant in Supabase Staging.
 * Server-side only: run from a trusted terminal, never from the browser or CI.
 *
 *   E2E_BASE_URL=… E2E_SUPABASE_URL=… E2E_R2_BUCKET=… \
 *   E2E_USER_EMAIL=… E2E_USER_PASSWORD=… E2E_SUPABASE_SECRET_KEY=… \
 *   npx tsx e2e/staging/seed.ts
 *
 * Uses the existing internal provisioning RPC `create_internal_organization_v1`
 * (service_role only), which creates tenant, owner membership, settings and
 * default catalogs in one transaction. Re-running only re-syncs the password.
 * Nothing is deleted; DEMO, AUDIT and any other tenant are never read or written.
 *
 * Storage capacity (S2): a tenant without a subscription has 0 bytes, so the
 * upload steps need an explicit internal Basic subscription. When the tenant
 * has no current subscription the seed grants one through the audited
 * `grant_internal_subscription_v1`, which requires an authorizer:
 *
 *   E2E_CAPACITY_AUTHORIZED_BY=<who authorizes> npx tsx e2e/staging/seed.ts
 */
import { createClient } from "@supabase/supabase-js";
import { E2E_TENANT_SLUG, resolveStagingTarget } from "./guard";
import { Redactor } from "./redact";
import { requireSyntheticEmail } from "./synthetic";

const TENANT_NAME = "Gestcopy E2E";

async function main() {
  const target = resolveStagingTarget();
  const email = requireSyntheticEmail(process.env.E2E_USER_EMAIL);
  const password = process.env.E2E_USER_PASSWORD ?? "";
  const secretKey = process.env.E2E_SUPABASE_SECRET_KEY ?? "";
  if (password.length < 16) throw new Error("E2E_USER_PASSWORD must have at least 16 characters");
  if (!secretKey) throw new Error("E2E_SUPABASE_SECRET_KEY is required (server-side only)");
  const redactor = new Redactor([password, secretKey]);
  const log = (message: string) => console.log(redactor.text(`[e2e-seed] ${message}`));

  const admin = createClient(target.supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Synthetic auth user (exact email match; listUsers is paginated).
  let userId: string | null = null;
  for (let page = 1; !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    userId = data.users.find((user) => user.email?.toLowerCase() === email)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) throw new Error(`updateUserById failed: ${error.message}`);
    log(`auth user exists, password re-synced (${email})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "E2E Owner (synthetic)" },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
    userId = data.user.id;
    log(`auth user created (${email})`);
  }

  // 2. Tenant through the internal provisioning RPC, only when absent.
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, slug, active, provisioning_state")
    .eq("slug", E2E_TENANT_SLUG)
    .maybeSingle();
  if (tenantError) throw new Error(`tenant lookup failed: ${tenantError.message}`);

  let tenantId: string;
  if (!tenant) {
    const { data, error } = await admin.rpc("create_internal_organization_v1", {
      p_user_id: userId,
      p_name: TENANT_NAME,
      p_slug: E2E_TENANT_SLUG,
      p_timezone: "Europe/Madrid",
    });
    if (error) throw new Error(`create_internal_organization_v1 failed: ${error.message}`);
    tenantId = (data as { tenant_id: string }).tenant_id;
    log(`tenant ${E2E_TENANT_SLUG} provisioned`);
  } else {
    tenantId = tenant.id;
    if (!tenant.active || tenant.provisioning_state !== "ready") {
      throw new Error(`tenant ${E2E_TENANT_SLUG} exists but is not active/ready; fix manually, the seed never repairs it`);
    }
    log(`tenant ${E2E_TENANT_SLUG} already provisioned`);
  }

  // 3. Isolation check: the synthetic user belongs to the e2e tenant only.
  const { data: memberships, error: membershipError } = await admin
    .from("memberships")
    .select("tenant_id, role, active")
    .eq("user_id", userId);
  if (membershipError) throw new Error(`membership lookup failed: ${membershipError.message}`);
  const own = memberships.find((m) => m.tenant_id === tenantId);
  if (!own || !own.active || own.role !== "owner") {
    throw new Error(`synthetic user is not the active owner of ${E2E_TENANT_SLUG}; refusing to continue`);
  }
  if (memberships.some((m) => m.tenant_id !== tenantId)) {
    throw new Error("synthetic user has memberships outside the e2e tenant; refusing to continue");
  }

  const { data: statuses, error: statusError } = await admin
    .from("order_statuses")
    .select("code, is_initial, active")
    .eq("tenant_id", tenantId);
  if (statusError) throw new Error(`status lookup failed: ${statusError.message}`);
  if (statuses.filter((s) => s.is_initial && s.active).length !== 1) {
    throw new Error("e2e tenant must have exactly one active initial order status");
  }

  // 4. Explicit storage capacity: internal Basic subscription, granted once.
  const { data: current, error: currentError } = await admin
    .from("subscriptions")
    .select("id, provider, status")
    .eq("tenant_id", tenantId)
    .in("status", ["trialing", "active", "past_due"]);
  if (currentError) throw new Error(`subscription lookup failed: ${currentError.message}`);
  if (current.length === 0) {
    const authorizedBy = (process.env.E2E_CAPACITY_AUTHORIZED_BY ?? "").trim();
    if (!authorizedBy) {
      throw new Error(
        "e2e tenant has no subscription (storage capacity 0); set E2E_CAPACITY_AUTHORIZED_BY to grant the internal Basic one"
      );
    }
    const { data: grant, error: grantError } = await admin.rpc("grant_internal_subscription_v1", {
      p_tenant_id: tenantId,
      p_plan_code: "basic",
      p_status: "active",
      p_current_period_end: null,
      p_reason: "Staging e2e synthetic tenant: explicit Basic storage capacity (S2)",
      p_authorized_by: authorizedBy,
      p_metadata: { source_detail: "e2e_seed", billing_activation: "internal_pilot" },
    });
    const outcome = (grant as { outcome?: string; reason?: string } | null) ?? null;
    if (grantError || outcome?.outcome !== "granted") {
      throw new Error(`grant_internal_subscription_v1 failed: ${grantError?.message ?? outcome?.reason ?? "unknown"}`);
    }
    log("internal Basic subscription granted (audited)");
  } else {
    log(`current subscription present (${current[0].provider ?? "internal"}, ${current[0].status})`);
  }

  log(`ready: owner membership ok, ${statuses.length} order statuses`);
}

main().catch((error: unknown) => {
  const redactor = new Redactor([process.env.E2E_USER_PASSWORD, process.env.E2E_SUPABASE_SECRET_KEY]);
  console.error(redactor.text(`[e2e-seed] FAILED: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
});
