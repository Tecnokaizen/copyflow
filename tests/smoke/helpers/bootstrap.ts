import { randomUUID } from "node:crypto";
import { anonClient, serviceClient, userClient } from "./supabase";
import { appAuthCookies, type AppCookie } from "./app";

export type TestActor = {
  email: string;
  password: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  tenantSlug: string;
  /** @supabase/ssr cookies for hitting the real Next.js API routes as this user. */
  cookies: AppCookie[];
};

// Track everything we create so teardown can remove it via service-role.
const createdUserIds = new Set<string>();
const createdTenantIds = new Set<string>();

const PASSWORD = "Password123!";

function uniqueSlug(): string {
  // Valid slug (^[a-z0-9]+(-[a-z0-9]+)*$) and never a reserved product slug.
  return `smoke-${randomUUID().slice(0, 8)}`;
}

/** Create a confirmed auth user via the real signup flow (no service-role). */
export async function signUpUser(): Promise<{
  email: string;
  password: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}> {
  const email = `smoke-${Date.now()}-${randomUUID().slice(0, 8)}@smoke.test`;
  const anon = anonClient();
  const { data, error } = await anon.auth.signUp({ email, password: PASSWORD });

  if (error || !data.user || !data.session) {
    throw new Error(`signUp failed: ${error?.message ?? "no session returned"}`);
  }

  createdUserIds.add(data.user.id);
  return {
    email,
    password: PASSWORD,
    userId: data.user.id,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

/** Run the real onboarding RPC to create a tenant + owner membership. */
export async function createTenantFor(accessToken: string): Promise<{
  tenantId: string;
  tenantSlug: string;
}> {
  const slug = uniqueSlug();
  const sb = userClient(accessToken);
  const { data, error } = await sb.rpc("create_organization", {
    p_name: `Smoke ${slug}`,
    p_slug: slug,
    p_timezone: "Europe/Madrid",
  });

  if (error || !data) {
    throw new Error(`create_organization failed: ${error?.message ?? "no data"}`);
  }

  const tenantId = (data as { tenant_id?: string }).tenant_id;
  if (!tenantId) {
    throw new Error("create_organization returned no tenant_id");
  }

  createdTenantIds.add(tenantId);
  return { tenantId, tenantSlug: slug };
}

/** Full self-sufficient actor: user + tenant + owner membership + app cookies. */
export async function bootstrapActor(): Promise<TestActor> {
  const user = await signUpUser();
  const tenant = await createTenantFor(user.accessToken);
  const cookies = await appAuthCookies({
    accessToken: user.accessToken,
    refreshToken: user.refreshToken,
  });
  return { ...user, ...tenant, cookies };
}

/** Create a team member for a tenant using the owner's real authenticated context. */
export async function createTeamMember(
  accessToken: string,
  tenantId: string,
  name = "Responsable Smoke",
): Promise<string> {
  const sb = userClient(accessToken);
  const { data, error } = await sb
    .from("team_members")
    .insert({
      tenant_id: tenantId,
      name,
      active: true,
      can_receive_orders: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`create team_member failed: ${error?.message ?? "no data"}`);
  }

  return data.id as string;
}

/** Remove everything created during the run. Best-effort; never throws. */
export async function cleanupAll(): Promise<void> {
  const svc = serviceClient();

  for (const tenantId of createdTenantIds) {
    try {
      await svc.from("tenants").delete().eq("id", tenantId);
    } catch {
      /* best-effort */
    }
  }
  createdTenantIds.clear();

  for (const userId of createdUserIds) {
    try {
      await svc.from("profiles").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort */
    }
  }
  createdUserIds.clear();
}

/**
 * Safety-net sweep: remove any leftover smoke tenants/users even if a test
 * crashed before its own cleanup ran. Matches only the dedicated smoke naming
 * conventions so it can never touch real data. Best-effort; never throws.
 */
export async function sweepSmokeData(): Promise<void> {
  const svc = serviceClient();

  try {
    await svc.from("tenants").delete().ilike("slug", "smoke-%");
  } catch {
    /* best-effort */
  }

  try {
    const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const user of data?.users ?? []) {
      if (user.email?.endsWith("@smoke.test")) {
        try {
          await svc.from("profiles").delete().eq("id", user.id);
          await svc.auth.admin.deleteUser(user.id);
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    /* best-effort */
  }
}
