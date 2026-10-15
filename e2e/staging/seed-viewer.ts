/**
 * Optional second synthetic role for the Pro early access walkthrough: an
 * active `viewer` of the `e2e` tenant in Supabase Staging. Server-side only:
 * run from a trusted terminal after seed.ts, never from the browser or CI.
 *
 *   E2E_BASE_URL=… E2E_SUPABASE_URL=… E2E_R2_BUCKET=… \
 *   E2E_VIEWER_EMAIL=e2e-viewer@example.com E2E_VIEWER_PASSWORD=… \
 *   E2E_SUPABASE_SECRET_KEY=… npx tsx e2e/staging/seed-viewer.ts
 *
 * Re-running only re-syncs the password. Refuses to continue when the user
 * belongs to another tenant or already has a different role in `e2e`.
 * Nothing is deleted; no other tenant or membership is read or written.
 */
import { createClient } from "@supabase/supabase-js";
import { E2E_TENANT_SLUG, resolveStagingTarget } from "./guard";
import { Redactor } from "./redact";
import { requireSyntheticEmail } from "./synthetic";

async function main() {
  const target = resolveStagingTarget();
  const email = requireSyntheticEmail(process.env.E2E_VIEWER_EMAIL);
  const password = process.env.E2E_VIEWER_PASSWORD ?? "";
  const secretKey = process.env.E2E_SUPABASE_SECRET_KEY ?? "";
  if (password.length < 16) throw new Error("E2E_VIEWER_PASSWORD must have at least 16 characters");
  if (!secretKey) throw new Error("E2E_SUPABASE_SECRET_KEY is required (server-side only)");
  if (email === process.env.E2E_USER_EMAIL?.trim().toLowerCase()) {
    throw new Error("E2E_VIEWER_EMAIL must differ from the owner E2E_USER_EMAIL");
  }
  const redactor = new Redactor([password, secretKey]);
  const log = (message: string) => console.log(redactor.text(`[e2e-seed-viewer] ${message}`));

  const admin = createClient(target.supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, active, provisioning_state")
    .eq("slug", E2E_TENANT_SLUG)
    .maybeSingle();
  if (tenantError) throw new Error(`tenant lookup failed: ${tenantError.message}`);
  if (!tenant || !tenant.active || tenant.provisioning_state !== "ready") {
    throw new Error(`tenant ${E2E_TENANT_SLUG} must exist and be active/ready (run seed.ts first)`);
  }

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
      user_metadata: { full_name: "E2E Viewer (synthetic)" },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
    userId = data.user.id;
    log(`auth user created (${email})`);
  }

  // 2. Isolation: only an active viewer membership in e2e is acceptable.
  const { data: memberships, error: membershipError } = await admin
    .from("memberships")
    .select("tenant_id, role, active")
    .eq("user_id", userId);
  if (membershipError) throw new Error(`membership lookup failed: ${membershipError.message}`);
  if (memberships.some((m) => m.tenant_id !== tenant.id)) {
    throw new Error("synthetic viewer has memberships outside the e2e tenant; refusing to continue");
  }
  const own = memberships.find((m) => m.tenant_id === tenant.id);
  if (own) {
    if (own.role !== "viewer" || !own.active) {
      throw new Error("synthetic viewer already has another role or is inactive in e2e; fix manually");
    }
    log("viewer membership already present");
    return;
  }

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, full_name: "E2E Viewer (synthetic)" }, { onConflict: "id", ignoreDuplicates: true });
  if (profileError) throw new Error(`profile upsert failed: ${profileError.message}`);
  const { error: insertError } = await admin
    .from("memberships")
    .insert({ tenant_id: tenant.id, user_id: userId, role: "viewer", active: true });
  if (insertError) throw new Error(`membership insert failed: ${insertError.message}`);
  log(`viewer membership created in ${E2E_TENANT_SLUG}`);
}

main().catch((error: unknown) => {
  const redactor = new Redactor([process.env.E2E_VIEWER_PASSWORD, process.env.E2E_SUPABASE_SECRET_KEY]);
  console.error(redactor.text(`[e2e-seed-viewer] FAILED: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
});
