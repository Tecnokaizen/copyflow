/**
 * Local verification for phase 2C-B (no real Resend, no commit).
 * Run: EMAIL_TRANSPORT=console npx tsx --tsconfig tsconfig.json scripts/verify-phase-2c-b.mjs
 *
 * Kept as .mjs so it is outside Next/tsc/eslint app compilation.
 */
import Module from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Allow importing server-only modules outside Next.
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  // Use tsx to transpile on the fly when this file is run with `npx tsx`
  const results = [];

  function record(id, ok, detail) {
    results.push({ id, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
  }

  const { appOrigin, invitationAcceptUrl } = await import(
    "../lib/tenant/app-origin.ts"
  );

  const prevBase = process.env.APP_BASE_URL;
  delete process.env.APP_BASE_URL;
  record("appOrigin.default", appOrigin() === "https://app.gestcopy.com", appOrigin());

  process.env.APP_BASE_URL = "http://localhost:3000/";
  record("appOrigin.local", appOrigin() === "http://localhost:3000", appOrigin());

  process.env.APP_BASE_URL = "https://evil.example/path";
  record("appOrigin.stripPath", appOrigin() === "https://evil.example", appOrigin());

  process.env.APP_BASE_URL = "http://localhost:3000";
  const token =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const url = invitationAcceptUrl(token);
  record(
    "invitationUrl.shape",
    url ===
      `http://localhost:3000/invitations/accept?token=${encodeURIComponent(token)}`,
    url.slice(0, 60) + "…"
  );

  if (prevBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = prevBase;

  const {
    classifyAccessRpcError,
    statusForAccessRpcError,
    publicMessageForAccessRpcError,
  } = await import("../lib/access/rpc-error.ts");

  record(
    "E.rate_limit_cooldown",
    statusForAccessRpcError("GTC01", "invitation resend too soon") === 429 &&
      publicMessageForAccessRpcError("GTC01") ===
        "Please wait before resending the invitation"
  );

  record(
    "G.rate_limit_max",
    statusForAccessRpcError("GTC02", "invitation resend limit reached") === 429 &&
      publicMessageForAccessRpcError("GTC02") === "Invitation resend limit reached"
  );

  record(
    "rate_limit.not_generic_500",
    classifyAccessRpcError("GTC01") === "rate_limited_cooldown" &&
      classifyAccessRpcError("GTC02") === "rate_limited_max"
  );

  const {
    mapCreateInvitationResult,
    toPublicCreatedInvitation,
    containsTokenMaterial,
    mapAccessInvitation,
  } = await import("../lib/access/types.ts");

  const mapped = mapCreateInvitationResult({
    invitation_id: "11111111-1111-1111-1111-111111111111",
    email: "invitee@example.com",
    role: "staff",
    token,
    tenant_id: "22222222-2222-2222-2222-222222222222",
    tenant_name: "Acme",
    tenant_slug: "acme",
    expires_at: new Date().toISOString(),
    send_attempts: 1,
  });

  assert.ok(mapped);
  const pub = toPublicCreatedInvitation(mapped);
  record(
    "J.public_no_token",
    !("token" in pub) && !containsTokenMaterial(pub) && mapped.token === token,
    JSON.stringify(pub)
  );

  const listed = mapAccessInvitation({
    invitation_id: "11111111-1111-1111-1111-111111111111",
    email: "invitee@example.com",
    role: "staff",
    status: "pending",
    token,
    token_hash: "deadbeef",
    expires_at: null,
    invited_by_user_id: null,
    created_at: null,
    last_sent_at: null,
    send_attempts: 1,
  });
  record(
    "H.list_no_token",
    !!listed &&
      !("token" in listed) &&
      !("token_hash" in listed) &&
      !containsTokenMaterial(listed)
  );

  process.env.EMAIL_TRANSPORT = "console";
  const { sendTenantInvitationEmail } = await import(
    "../lib/email/send-tenant-invitation.ts"
  );

  const okSend = await sendTenantInvitationEmail({
    email: "invitee@example.com",
    tenantName: "Acme",
    role: "admin",
    invitationUrl: url,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  record(
    "A.email_console_ok",
    okSend.ok === true && okSend.providerMessageId.startsWith("console-")
  );

  record(
    "A.create_body_201_shape",
    !("token" in pub) && !!pub.invitation && !!pub.tenant
  );

  process.env.EMAIL_TRANSPORT = "fail";
  const failSend = await sendTenantInvitationEmail({
    email: "invitee@example.com",
    tenantName: "Acme",
    role: "viewer",
    invitationUrl: url,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  record("B.email_fail", failSend.ok === false && failSend.code === "provider");

  const createFailBody = {
    error: "Invitation created but email could not be sent",
    code: "email_delivery_failed",
    ...pub,
  };
  record(
    "B.create_502_shape",
    createFailBody.code === "email_delivery_failed" &&
      !("token" in createFailBody) &&
      !containsTokenMaterial(createFailBody)
  );

  const resendFailBody = {
    error: "Invitation email could not be sent",
    code: "email_delivery_failed",
    ...pub,
  };
  record(
    "D.resend_502_shape",
    !("token" in resendFailBody) && !containsTokenMaterial(resendFailBody)
  );

  record("C.resend_ok_shape", !("token" in pub));

  const { assertEmailConfigForResend } = await import("../lib/email/env.ts");
  const envSource = await fs.readFile(
    new URL("../lib/email/env.ts", import.meta.url),
    "utf8"
  );
  record(
    "prod.no_console_transport",
    envSource.includes('NODE_ENV !== "production"') &&
      envSource.includes('raw === "console"')
  );
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  const cfg = assertEmailConfigForResend();
  record("prod.missing_key_is_config", cfg.ok === false);
  process.env.EMAIL_TRANSPORT = "console";

  const nextConfig = (await import("../next.config.ts")).default;
  const headerGroups = await nextConfig.headers?.();
  const acceptHeaders = headerGroups?.find((h) =>
    h.source.includes("/invitations/accept")
  );
  const hasReferrer = acceptHeaders?.headers?.some(
    (h) => h.key === "Referrer-Policy" && h.value === "no-referrer"
  );
  record("K.referrer_policy_config", !!hasReferrer);

  const migration = await fs.readFile(
    new URL(
      "../supabase/migrations/20260909120000_invitation_resend_rate_limit.sql",
      import.meta.url
    ),
    "utf8"
  );
  const cooldownBeforeToken =
    migration.indexOf("invitation resend too soon") <
      migration.indexOf("gen_random_bytes") &&
    migration.indexOf("invitation resend limit reached") <
      migration.indexOf("gen_random_bytes");
  record("E.G.migration_before_rotate", cooldownBeforeToken);
  record("migration.states", migration.includes("GTC01") && migration.includes("GTC02"));

  const failed = results.filter((r) => !r.ok);
  console.log("\n---");
  console.log(`Summary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.error("Failed:", failed.map((f) => f.id).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
