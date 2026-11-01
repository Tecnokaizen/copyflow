/**
 * SUR4 E10: idempotent provisioning of the four synthetic tenants of the
 * feature matrix (contract §11) in Supabase Staging, or in a local stack with
 * E2E_SUR4_MODE=local. Server-side only: run from a trusted terminal.
 *
 *   E2E_SUPABASE_URL=… E2E_R2_BUCKET=… E2E_SUPABASE_SECRET_KEY=… \
 *   E2E_SUR4_PASSWORD=… E2E_SUR4_OPERATOR=<who authorizes the grants> \
 *   npx tsx e2e/staging/seed-sur4.ts
 *
 * Per tenant: a synthetic owner (`{slug}-owner@example.com`, created with
 * email_confirm, so no email is sent), the tenant through
 * `create_internal_organization_v1` when absent, and the four order features
 * set to the matrix through the audited `set_tenant_feature_v2` (only when the
 * state differs). completo also gets a synthetic `viewer` member
 * (`{slug}-viewer@example.com`), as seed-viewer.ts does for `e2e`.
 * Re-running only re-syncs passwords and grants. Nothing is
 * deleted; `e2e`, DEMO, AUDIT, SUR4 and any other tenant are never read or written.
 * Team, stores and orders are created by the runner through the app API.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSur4Targets } from "./guard";
import { Redactor } from "./redact";
import { adminClient, setFeature, tenantIdOf } from "./sur4-admin";
import { SUR4_FEATURE_KEYS, SUR4_MATRIX, ownerEmail, type Sur4Tenant } from "./sur4-matrix";

async function findUser(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
}

async function ensureUser(admin: SupabaseClient, email: string, password: string, fullName: string): Promise<string> {
  const existing = await findUser(admin, email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing, { password, email_confirm: true });
    if (error) throw new Error(`updateUserById failed: ${error.message}`);
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
  return data.user.id;
}

/** Memberships of a synthetic user: only `tenantId`, with `role`, or none yet. */
async function membershipIn(admin: SupabaseClient, userId: string, tenantId: string, role: string, email: string) {
  const { data, error } = await admin.from("memberships").select("tenant_id, role, active").eq("user_id", userId);
  if (error) throw new Error(`membership lookup failed: ${error.message}`);
  if (data.some((m) => m.tenant_id !== tenantId)) throw new Error(`${email} has memberships outside its tenant; refusing to continue`);
  const own = data.find((m) => m.tenant_id === tenantId) ?? null;
  if (own && (own.role !== role || !own.active)) throw new Error(`${email} is not an active ${role}; fix manually, the seed never repairs it`);
  return own;
}

async function seedTenant(admin: SupabaseClient, tenant: Sur4Tenant, password: string, operator: string, log: (m: string) => void) {
  const email = ownerEmail(tenant.slug);

  const userId = await ensureUser(admin, email, password, `${tenant.name} (synthetic owner)`);

  let tenantId = await tenantIdOf(admin, tenant.slug);
  if (!tenantId) {
    const { data, error } = await admin.rpc("create_internal_organization_v1", {
      p_user_id: userId,
      p_name: tenant.name,
      p_slug: tenant.slug,
      p_timezone: "Europe/Madrid",
    });
    if (error) throw new Error(`create_internal_organization_v1(${tenant.slug}) failed: ${error.message}`);
    tenantId = (data as { tenant_id: string }).tenant_id;
    log(`${tenant.slug}: tenant provisioned`);
  }

  // Isolation: the synthetic owner belongs to its tenant only, as owner.
  if (!(await membershipIn(admin, userId, tenantId, "owner", email))) throw new Error(`${email} is not the owner of ${tenant.slug}`);

  if (tenant.viewer) {
    const viewerEmail = ownerEmail(tenant.slug, "viewer");
    const viewerId = await ensureUser(admin, viewerEmail, password, `${tenant.name} (synthetic viewer)`);
    if (!(await membershipIn(admin, viewerId, tenantId, "viewer", viewerEmail))) {
      // memberships.user_id references profiles; the owner got one from the provisioning RPC.
      const { error: profileError } = await admin
        .from("profiles")
        .upsert({ id: viewerId, full_name: `${tenant.name} (synthetic viewer)` }, { onConflict: "id", ignoreDuplicates: true });
      if (profileError) throw new Error(`profile upsert failed: ${profileError.message}`);
      const { error } = await admin.from("memberships").insert({ tenant_id: tenantId, user_id: viewerId, role: "viewer", active: true });
      if (error) throw new Error(`viewer membership insert failed: ${error.message}`);
      log(`${tenant.slug}: viewer membership added`);
    }
  }

  const changed: string[] = [];
  for (const key of SUR4_FEATURE_KEYS) {
    const outcome = await setFeature(
      admin, tenant.slug, tenantId, key, tenant.features[key],
      `SUR4 E10 Staging matrix (contract §11): ${tenant.slug} ${key}=${tenant.features[key] ? "on" : "off"}`,
      operator,
    );
    if (outcome === "changed") changed.push(`${key}=${tenant.features[key] ? "on" : "off"}`);
  }
  log(`${tenant.slug}: owner ok, features ${changed.length ? `changed (${changed.join(", ")})` : "already as the matrix"}`);
}

async function main() {
  const targets = resolveSur4Targets();
  const password = process.env.E2E_SUR4_PASSWORD ?? "";
  const secretKey = process.env.E2E_SUPABASE_SECRET_KEY ?? "";
  const operator = (process.env.E2E_SUR4_OPERATOR ?? "").trim();
  if (password.length < 16) throw new Error("E2E_SUR4_PASSWORD must have at least 16 characters");
  if (!operator) throw new Error("E2E_SUR4_OPERATOR is required: who authorizes the feature grants (audited)");
  const redactor = new Redactor([password, secretKey]);
  const log = (message: string) => console.log(redactor.text(`[e2e-sur4-seed] ${message}`));
  log(`mode ${targets.mode}, ${SUR4_MATRIX.length} tenants`);

  const admin = adminClient(targets, secretKey);
  for (const tenant of SUR4_MATRIX) await seedTenant(admin, tenant, password, operator, log);
  log("ready");
}

main().catch((error: unknown) => {
  const redactor = new Redactor([process.env.E2E_SUR4_PASSWORD, process.env.E2E_SUPABASE_SECRET_KEY]);
  console.error(redactor.text(`[e2e-sur4-seed] FAILED: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
});
