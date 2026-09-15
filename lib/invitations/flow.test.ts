import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantOrigin } from "@/lib/tenant/domains";
import { parseInvitationSignupPayload } from "@/lib/access/payload";
import {
  classifyAccessRpcError,
  publicApiErrorCode,
  rpcErrorDigest,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { invitationAcceptRpcFailure } from "./accept-error";
import { completeInvitationSignup } from "./complete-signup";
import {
  invitationAcceptFailureView,
  invitationAcceptView,
} from "./view-state";
import {
  ACCOUNT_EXISTS,
  ACTIVATE_ACCESS_AND_CONTINUE,
  ACTIVATE_ACCESS_TITLE,
  EMAIL_LABEL,
  INVITATION_EMAIL_MISMATCH,
  PASSWORD_LABEL,
  REPEAT_PASSWORD_LABEL,
  SIGN_IN_TITLE,
  invitationActivateDescription,
  invitationWrongAccountCopy,
} from "./copy";
import { allowsUnauthenticatedPath } from "./public-path";
import {
  invitationFlowDestination,
  shouldStayOnInvitationAccept,
} from "./redirect";
import { parseInvitationToken } from "./token";
import {
  mapInvitationPreview,
  toPublicInvitationPreview,
} from "./preview";
import { parseResolvedInvitationAuthUserId } from "./resolve-auth-user";
import { planInvitationSignup } from "./signup-plan";

const TOKEN = "a".repeat(64);
const INVITED_EMAIL = "reservas@dj-kaizen.com";
const OTHER_EMAIL = "cuentas@tecnokaizen.com";
const ORPHAN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_A = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "DJ Kaizen",
  slug: "dj-kaizen",
};
const TENANT_B = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Otra copistería",
  slug: "otra",
};

function pendingPreview(
  overrides: Record<string, unknown> = {}
) {
  return mapInvitationPreview({
    status: "pending",
    email: INVITED_EMAIL,
    name: "Reservas",
    tenant: TENANT_A,
    requires_login: false,
    role: "staff",
    add_to_personal: true,
    ...overrides,
  });
}

function signupDeps(overrides: {
  preview?: () => Promise<ReturnType<typeof pendingPreview>>;
  resolveExistingAuthUser?: (token: string) => Promise<string | null>;
  userHasMembership?: (userId: string) => Promise<boolean>;
  createConfirmedUser?: (input: {
    email: string;
    password: string;
    emailConfirm: boolean;
    name: string | null;
  }) => Promise<{ id: string }>;
  recoverOrphanUser?: (input: {
    token: string;
    email: string;
    password: string;
    emailConfirm: boolean;
  }) => Promise<void>;
  signIn?: (input: { email: string; password: string }) => Promise<void>;
  accept?: (token: string) => Promise<{
    tenant: typeof TENANT_A;
    membership: { role: string; active: boolean };
    team_member_id: string | null;
  }>;
  sendAuthEmail?: (kind: string) => Promise<void>;
} = {}) {
  return {
    preview: async () => pendingPreview(),
    resolveExistingAuthUser: async () => null,
    userHasMembership: async () => false,
    createConfirmedUser: async () => ({ id: "user-1" }),
    recoverOrphanUser: async () => undefined,
    signIn: async () => undefined,
    accept: async () => ({
      tenant: TENANT_A,
      membership: { role: "staff", active: true },
      team_member_id: "member-1",
    }),
    ...overrides,
  };
}

describe("invitation account state", () => {
  it("1. no auth user → activar acceso", () => {
    const preview = pendingPreview({ requires_login: false });
    assert.ok(preview);
    const view = invitationAcceptView({
      token: TOKEN,
      preview,
      sessionEmail: null,
    });
    assert.equal(view.kind, "activate");
    if (view.kind !== "activate") return;
    assert.equal(view.email, INVITED_EMAIL);
    assert.equal(view.emailReadOnly, true);
    assert.equal(view.tenantName, "DJ Kaizen");
    assert.equal(
      invitationActivateDescription(view.tenantName),
      "Te han invitado a DJ Kaizen. Elige una contraseña para empezar."
    );
    assert.equal(ACTIVATE_ACCESS_TITLE, "Activa tu acceso");
    assert.equal(ACTIVATE_ACCESS_AND_CONTINUE, "Activar acceso y continuar");
    assert.equal(EMAIL_LABEL, "Correo");
    assert.equal(PASSWORD_LABEL, "Contraseña");
    assert.equal(REPEAT_PASSWORD_LABEL, "Repetir contraseña");
    for (const text of [
      ACTIVATE_ACCESS_TITLE,
      ACTIVATE_ACCESS_AND_CONTINUE,
      invitationActivateDescription(view.tenantName),
      EMAIL_LABEL,
      PASSWORD_LABEL,
      REPEAT_PASSWORD_LABEL,
    ]) {
      assert.equal(/sign up/i.test(text), false);
      assert.equal(/\bpassword\b/i.test(text), false);
      assert.equal(/repeat password/i.test(text), false);
    }

    const plan = planInvitationSignup({
      preview,
      password: "secreto12",
    });
    assert.equal(plan.action, "activate");
  });

  it("2. auth user no confirmado sin memberships → activar acceso", () => {
    const preview = pendingPreview({
      requires_login: false,
      account_exists: true,
      email_confirmed: false,
    });
    assert.ok(preview);
    assert.equal(preview.requires_login, false);
    assert.equal("account_exists" in preview, false);
    assert.equal("email_confirmed" in preview, false);
    const view = invitationAcceptView({
      token: TOKEN,
      preview,
      sessionEmail: null,
    });
    assert.equal(view.kind, "activate");
    const plan = planInvitationSignup({ preview, password: "secreto12" });
    assert.equal(plan.action, "activate");
  });

  it("3. auth user confirmado SIN memberships → activar acceso", () => {
    const preview = pendingPreview({
      requires_login: false,
      account_exists: true,
      email_confirmed: true,
    });
    assert.ok(preview);
    const view = invitationAcceptView({
      token: TOKEN,
      preview,
      sessionEmail: null,
    });
    assert.equal(view.kind, "activate");
    assert.notEqual(view.kind, "login");
  });

  it("4-5. cuenta huérfana redefine contraseña y no manda email", async () => {
    const preview = pendingPreview({ requires_login: false });
    assert.ok(preview);
    const calls: string[] = [];
    const recovered: Array<{
      token: string;
      email: string;
      password: string;
      emailConfirm: boolean;
    }> = [];

    const result = await completeInvitationSignup(
      { token: TOKEN, password: "nueva-clave-99" },
      signupDeps({
        preview: async () => preview,
        resolveExistingAuthUser: async (token) => {
          assert.equal(token, TOKEN);
          calls.push("resolve");
          return ORPHAN_ID;
        },
        userHasMembership: async (userId) => {
          assert.equal(userId, ORPHAN_ID);
          calls.push("memberships");
          return false;
        },
        createConfirmedUser: async () => {
          throw new Error("must not create a duplicate user");
        },
        recoverOrphanUser: async (input) => {
          recovered.push(input);
          calls.push("recover");
        },
        signIn: async (input) => {
          calls.push("signin");
          assert.equal(input.email, INVITED_EMAIL);
          assert.equal(input.password, "nueva-clave-99");
        },
        accept: async () => {
          calls.push("accept");
          return {
            tenant: TENANT_A,
            membership: { role: "staff", active: true },
            team_member_id: "member-1",
          };
        },
        sendAuthEmail: async () => {
          calls.push("email");
        },
      })
    );

    assert.equal(result.ok, true);
    assert.deepEqual(recovered, [
      {
        token: TOKEN,
        email: INVITED_EMAIL,
        password: "nueva-clave-99",
        emailConfirm: true,
      },
    ]);
    assert.deepEqual(calls, [
      "resolve",
      "memberships",
      "recover",
      "signin",
      "accept",
    ]);
  });

  it("6-7. auth user confirmado CON membership → login y no sobrescribe contraseña", async () => {
    const preview = pendingPreview({ requires_login: true });
    assert.ok(preview);
    const view = invitationAcceptView({
      token: TOKEN,
      preview,
      sessionEmail: null,
    });
    assert.equal(view.kind, "login");
    if (view.kind !== "login") return;
    assert.equal(view.email, INVITED_EMAIL);
    assert.equal(view.emailReadOnly, true);
    assert.equal(SIGN_IN_TITLE, "Iniciar sesión");

    const result = await completeInvitationSignup(
      { token: TOKEN, password: "intento-sobrescribir" },
      signupDeps({
        preview: async () => preview,
        resolveExistingAuthUser: async () => {
          throw new Error("login must not resolve the auth user");
        },
        userHasMembership: async () => {
          throw new Error("login must not inspect memberships to overwrite");
        },
        createConfirmedUser: async () => {
          throw new Error("must not create a duplicate user");
        },
        recoverOrphanUser: async () => {
          throw new Error("must not overwrite a Gestcopy member password");
        },
        signIn: async () => {
          throw new Error("login stays on the invitation page");
        },
        accept: async () => {
          throw new Error("must not accept before login");
        },
      })
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, ACCOUNT_EXISTS);
    assert.equal(result.status, 409);
  });

  it("8-12. activation → sesión → accept conserva role, Personal, accepted y tenant", async () => {
    const preview = pendingPreview();
    assert.ok(preview);
    const created: Array<{
      email: string;
      password: string;
      emailConfirm: boolean;
      name: string | null;
    }> = [];
    const calls: string[] = [];

    const result = await completeInvitationSignup(
      {
        token: TOKEN,
        password: "secreto12",
        emailFromClient: "atacante@evil.test",
      },
      signupDeps({
        preview: async () => preview,
        resolveExistingAuthUser: async () => {
          calls.push("resolve");
          return null;
        },
        createConfirmedUser: async (input) => {
          created.push(input);
          calls.push("create");
          return { id: "user-1" };
        },
        recoverOrphanUser: async () => {
          throw new Error("must not recover a missing user");
        },
        signIn: async (input) => {
          calls.push("signin");
          assert.equal(input.email, INVITED_EMAIL);
        },
        accept: async (token) => {
          calls.push("accept");
          assert.equal(token, TOKEN);
          return {
            tenant: TENANT_A,
            membership: { role: "staff", active: true },
            team_member_id: "member-1",
          };
        },
        sendAuthEmail: async () => {
          calls.push("email");
        },
      })
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(created, [
      {
        email: INVITED_EMAIL,
        password: "secreto12",
        emailConfirm: true,
        name: "Reservas",
      },
    ]);
    assert.deepEqual(calls, ["resolve", "create", "signin", "accept"]);
    assert.equal(result.membership.role, "staff");
    assert.equal(result.team_member_id, "member-1");
    assert.equal(result.tenant_origin, tenantOrigin("dj-kaizen"));
    assert.equal(result.tenant_origin.includes("onboarding"), false);
  });

  it("10. add_to_personal false no inventa ficha de Personal", async () => {
    const preview = pendingPreview({ add_to_personal: false, role: "viewer" });
    assert.ok(preview);
    const result = await completeInvitationSignup(
      { token: TOKEN, password: "secreto12" },
      signupDeps({
        preview: async () => preview,
        accept: async () => ({
          tenant: TENANT_A,
          membership: { role: "viewer", active: true },
          team_member_id: null,
        }),
      })
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.membership.role, "viewer");
    assert.equal(result.team_member_id, null);
  });

  it("membership check blocks password overwrite even if preview is stale", async () => {
    const preview = pendingPreview({ requires_login: false });
    assert.ok(preview);
    const result = await completeInvitationSignup(
      { token: TOKEN, password: "intento-sobrescribir" },
      signupDeps({
        preview: async () => preview,
        resolveExistingAuthUser: async () => ORPHAN_ID,
        userHasMembership: async () => true,
        createConfirmedUser: async () => {
          throw new Error("must not create");
        },
        recoverOrphanUser: async () => {
          throw new Error("must not overwrite member password");
        },
      })
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, ACCOUNT_EXISTS);
  });

  it("13. auth_user_id nunca aparece en preview público", () => {
    const preview = mapInvitationPreview({
      status: "pending",
      email: INVITED_EMAIL,
      name: "Reservas",
      tenant: TENANT_A,
      requires_login: false,
      auth_user_id: "should-stay-server-only",
      account_exists: true,
      email_confirmed: true,
      role: "staff",
      add_to_personal: true,
    });
    assert.ok(preview);
    assert.equal(preview.tenant?.id, TENANT_A.id);
    assert.notEqual(preview.tenant?.id, TENANT_B.id);
    assert.equal("auth_user_id" in preview, false);
    assert.equal("account_exists" in preview, false);
    assert.equal("email_confirmed" in preview, false);
    const publicPreview = toPublicInvitationPreview(preview);
    assert.equal("auth_user_id" in publicPreview, false);
    assert.equal("account_exists" in publicPreview, false);
    assert.equal("email_confirmed" in publicPreview, false);
    assert.equal(publicPreview.requires_login, false);
    assert.equal(publicPreview.tenant?.slug, "dj-kaizen");
  });

  it("14. error real de accept no se convierte en mensaje genérico incorrecto", () => {
    const hidden = invitationAcceptFailureView({
      status: 403,
      payload: { error: "Unauthorized or tenant access denied" },
      sessionEmail: INVITED_EMAIL,
      invitedEmail: INVITED_EMAIL,
      returnTo: `/invitations/accept?token=${TOKEN}`,
    });
    assert.equal(hidden.kind, "error");
    if (hidden.kind !== "error") return;
    assert.equal(hidden.message, "Unauthorized or tenant access denied");
    assert.equal(hidden.message.includes("No tienes acceso a esta invitación"), false);
    assert.equal(hidden.message.includes("otra cuenta"), false);

    const rpc = invitationAcceptRpcFailure({
      code: "42501",
      message: "permission denied",
      details: "Unauthorized or tenant access denied",
    });
    assert.equal(rpc.status, 403);
    assert.equal(rpc.code, undefined);
    assert.match(rpc.error, /permission denied|Unauthorized or tenant access denied/i);
    assert.equal(rpc.error.includes("No tienes acceso a esta invitación"), false);
  });
});

describe("invitation mismatch API code", () => {
  it("maps GTI01 from message or details to INVITATION_EMAIL_MISMATCH", () => {
    assert.equal(classifyAccessRpcError("GTI01"), "email_mismatch");
    assert.equal(
      classifyAccessRpcError("42501", "invitation email mismatch"),
      "email_mismatch"
    );
    const digest = rpcErrorDigest({
      code: "42501",
      message: "permission denied",
      details: "invitation email mismatch",
    });
    assert.equal(
      classifyAccessRpcError(digest.code, digest.message),
      "email_mismatch"
    );
    assert.equal(statusForAccessRpcError("GTI01"), 403);
    assert.equal(publicApiErrorCode("GTI01"), INVITATION_EMAIL_MISMATCH);
    assert.equal(
      publicApiErrorCode(digest.code, digest.message),
      INVITATION_EMAIL_MISMATCH
    );
    assert.notEqual(
      publicApiErrorCode("42501", "permission denied"),
      INVITATION_EMAIL_MISMATCH
    );

    const mapped = invitationAcceptRpcFailure({
      code: "42501",
      details: "invitation email mismatch",
    });
    assert.equal(mapped.code, INVITATION_EMAIL_MISMATCH);
    assert.equal(mapped.error, "Esta invitación es para otra cuenta");
  });
});

describe("invitation accept view extras", () => {
  it("signup email comes from the token preview, not from the browser", () => {
    const parsed = parseInvitationSignupPayload({
      token: TOKEN,
      password: "secreto12",
      email: "atacante@evil.test",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal("email" in parsed, false);

    const preview = pendingPreview();
    assert.ok(preview);
    const plan = planInvitationSignup({
      preview,
      password: "secreto12",
      emailFromClient: "atacante@evil.test",
    });
    assert.equal(plan.action, "activate");
    if (plan.action !== "activate") return;
    assert.equal(plan.email, INVITED_EMAIL);
    assert.notEqual(plan.email, "atacante@evil.test");
  });

  it("a session for another account keeps the token after continue", () => {
    const preview = pendingPreview();
    assert.ok(preview);
    const view = invitationAcceptView({
      token: TOKEN,
      preview,
      sessionEmail: OTHER_EMAIL,
    });
    assert.equal(view.kind, "wrong_account");
    if (view.kind !== "wrong_account") return;
    assert.equal(view.invitedEmail, INVITED_EMAIL);
    assert.equal(view.sessionEmail, OTHER_EMAIL);
    assert.equal(view.returnTo, `/invitations/accept?token=${TOKEN}`);
    const copy = invitationWrongAccountCopy(
      view.invitedEmail,
      view.sessionEmail
    );
    assert.match(
      copy.description,
      /Esta invitación corresponde a reservas@dj-kaizen.com/
    );
    assert.match(copy.description, /cuentas@tecnokaizen.com/);
    assert.equal(copy.action, "Continuar con reservas@dj-kaizen.com");
  });

  it("only the specific mismatch code with different emails shows the other-account screen", () => {
    const failure = invitationAcceptFailureView({
      status: 403,
      payload: {
        code: INVITATION_EMAIL_MISMATCH,
        error: "Esta invitación es para otra cuenta",
      },
      sessionEmail: OTHER_EMAIL,
      invitedEmail: INVITED_EMAIL,
      returnTo: `/invitations/accept?token=${TOKEN}`,
    });
    assert.equal(failure.kind, "wrong_account");

    const sameEmails = invitationAcceptFailureView({
      status: 403,
      payload: {
        code: INVITATION_EMAIL_MISMATCH,
        error: "Esta invitación es para otra cuenta",
      },
      sessionEmail: INVITED_EMAIL,
      invitedEmail: INVITED_EMAIL,
      returnTo: `/invitations/accept?token=${TOKEN}`,
    });
    assert.equal(sameEmails.kind, "error");
    if (sameEmails.kind !== "error") return;
    assert.equal(sameEmails.message, "Esta invitación es para otra cuenta");
  });

  it("expired, cancelled, superseded, accepted and invalid tokens stay as errors", () => {
    const cases = [
      { status: "expired", message: /caducado/i },
      { status: "cancelled", message: /cancelad/i },
      { status: "revoked", message: /cancelad/i },
      { status: "superseded", message: /ya no está vigente/i },
      { status: "accepted", message: /ya fue aceptada/i },
      { status: "not_found", message: /no es válida/i },
    ] as const;

    for (const row of cases) {
      const preview = mapInvitationPreview({
        status: row.status,
        email: null,
        name: null,
        tenant: null,
        requires_login: false,
        role: null,
        add_to_personal: false,
      });
      const view = invitationAcceptView({
        token: TOKEN,
        preview,
        sessionEmail: null,
      });
      assert.equal(view.kind, "error", row.status);
      if (view.kind !== "error") continue;
      assert.match(view.message, row.message);
    }

    const invalid = invitationAcceptView({
      token: "nope",
      preview: null,
      sessionEmail: null,
    });
    assert.equal(invalid.kind, "error");
    if (invalid.kind === "error") {
      assert.match(invalid.message, /no es válida/i);
    }
    assert.equal(parseInvitationToken("nope"), null);
    assert.equal(parseInvitationToken(TOKEN), TOKEN);
  });

  it("an invitation next path never falls through to onboarding or home", () => {
    const next = `/invitations/accept?token=${TOKEN}`;
    assert.equal(shouldStayOnInvitationAccept(next), true);
    assert.equal(invitationFlowDestination(next, "/onboarding"), next);
    assert.equal(invitationFlowDestination(next, "/"), next);
    assert.equal(
      invitationFlowDestination("/orders", "/onboarding"),
      "/orders"
    );
    assert.equal(allowsUnauthenticatedPath("/invitations/accept"), true);
    assert.equal(allowsUnauthenticatedPath("/onboarding"), false);
    assert.equal(allowsUnauthenticatedPath("/orders"), false);
    assert.equal(allowsUnauthenticatedPath("/auth/login"), true);
  });
});

describe("resolve invitation auth user id", () => {
  it("accepts only a uuid from the internal RPC", () => {
    assert.equal(
      parseResolvedInvitationAuthUserId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );
    assert.equal(parseResolvedInvitationAuthUserId("not-a-user"), null);
    assert.equal(parseResolvedInvitationAuthUserId(null), null);
  });
});
