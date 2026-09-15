import { tenantOrigin } from "@/lib/tenant/domains";
import { ACCOUNT_EXISTS } from "./copy";
import type { InvitationPreview } from "./preview";
import { planInvitationSignup } from "./signup-plan";

export type InvitationAcceptResult = {
  tenant: { id: string; name: string; slug: string };
  membership: { role: string; active: boolean };
  team_member_id: string | null;
};

export type InvitationSignupDeps = {
  preview: (token: string) => Promise<InvitationPreview | null>;
  resolveExistingAuthUser: (token: string) => Promise<string | null>;
  userHasMembership: (userId: string) => Promise<boolean>;
  createConfirmedUser: (input: {
    email: string;
    password: string;
    emailConfirm: boolean;
    name: string | null;
  }) => Promise<{ id: string }>;
  recoverOrphanUser: (input: {
    token: string;
    email: string;
    password: string;
    emailConfirm: boolean;
  }) => Promise<void>;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  accept: (token: string) => Promise<InvitationAcceptResult>;
  sendAuthEmail?: (kind: string) => Promise<void>;
};

export type CompleteInvitationSignupResult =
  | {
      ok: true;
      tenant_origin: string;
      membership: { role: string; active: boolean };
      team_member_id: string | null;
    }
  | { ok: false; code: string; error: string; status: number };

export async function completeInvitationSignup(
  input: {
    token: string;
    password: string;
    emailFromClient?: unknown;
  },
  deps: InvitationSignupDeps
): Promise<CompleteInvitationSignupResult> {
  const preview = await deps.preview(input.token);
  if (!preview) {
    return {
      ok: false,
      code: "INVITATION_UNAVAILABLE",
      error: "La invitación no es válida.",
      status: 404,
    };
  }

  const plan = planInvitationSignup({
    preview,
    password: input.password,
    emailFromClient: input.emailFromClient,
  });

  if (plan.action === "reject") {
    return {
      ok: false,
      code: plan.code,
      error: plan.error,
      status: plan.status,
    };
  }

  if (plan.action === "login_required") {
    return {
      ok: false,
      code: ACCOUNT_EXISTS,
      error: "Ya tienes una cuenta. Inicia sesión para continuar.",
      status: 409,
    };
  }

  const existingId = await deps.resolveExistingAuthUser(input.token);
  if (existingId) {
    if (await deps.userHasMembership(existingId)) {
      return {
        ok: false,
        code: ACCOUNT_EXISTS,
        error: "Ya tienes una cuenta. Inicia sesión para continuar.",
        status: 409,
      };
    }
    await deps.recoverOrphanUser({
      token: input.token,
      email: plan.email,
      password: plan.password,
      emailConfirm: plan.emailConfirm,
    });
  } else {
    await deps.createConfirmedUser({
      email: plan.email,
      password: plan.password,
      emailConfirm: plan.emailConfirm,
      name: plan.name,
    });
  }

  await deps.signIn({ email: plan.email, password: plan.password });

  const accepted = await deps.accept(input.token);

  return {
    ok: true,
    tenant_origin: tenantOrigin(accepted.tenant.slug),
    membership: accepted.membership,
    team_member_id: accepted.team_member_id,
  };
}
