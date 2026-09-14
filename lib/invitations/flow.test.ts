import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantOrigin } from "@/lib/tenant/domains";
import { parseInvitationSignupPayload } from "@/lib/access/payload";
import {
  classifyAccessRpcError,
  publicApiErrorCode,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { completeInvitationSignup } from "./complete-signup";
import {
  invitationAcceptFailureView,
  invitationAcceptView,
} from "./view-state";
import {
  INVITATION_EMAIL_MISMATCH,
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
  overrides: Partial<ReturnType<typeof mapInvitationPreview>> = {}
) {
  return mapInvitationPreview({
    status: "pending",
    email: INVITED_EMAIL,
    name: "Reservas",
    tenant: TENANT_A,
    account_exists: false,
    email_confirmed: false,
    role: "staff",
    add_to_personal: true,
    ...overrides,
  });
}

describe("invitation direct signup flow", () => {
  it("1. valid invitation + missing user shows create-account, not public signup", () => {
    const preview = pendingPreview();
    assert.ok(preview);
    const view = invitationAcceptView({
      token: TOKEN,
      preview,
      sessionEmail: null,
    });
    assert.equal(view.kind, "signup");
    if (view.kind !== "signup") return;
    assert.equal(view.email, INVITED_EMAIL);
    assert.equal(view.emailReadOnly, true);
  });

  it("2. signup email comes from the token preview, not from the browser", () => {
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
    assert.equal(plan.action, "create_confirmed");
    if (plan.action !== "create_confirmed") return;
    assert.equal(plan.email, INVITED_EMAIL);
    assert.notEqual(plan.email, "atacante@evil.test");
  });

  it("3-9. creates a confirmed user, skips a second email, accepts and redirects to the tenant", async () => {
    const preview = pendingPreview();
    assert.ok(preview);
    const calls: string[] = [];
    const created: Array<{
      email: string;
      password: string;
      emailConfirm: boolean;
      name: string | null;
    }> = [];

    const result = await completeInvitationSignup(
      {
        token: TOKEN,
        password: "secreto12",
        emailFromClient: "otro@mail.test",
      },
      {
        preview: async () => preview,
        createConfirmedUser: async (input) => {
          created.push(input);
          calls.push("create");
          return { id: "user-1" };
        },
        recoverUnconfirmedUser: async () => {
          calls.push("recover");
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
      }
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
    assert.deepEqual(calls, ["create", "signin", "accept"]);
    assert.equal(result.membership.role, "staff");
    assert.equal(result.team_member_id, "member-1");
    assert.equal(result.tenant_origin, tenantOrigin("dj-kaizen"));
    assert.equal(result.tenant_origin.includes("onboarding"), false);
  });

  it("8. access-only invitation does not invent a Personal card", async () => {
    const preview = pendingPreview({ add_to_personal: false, role: "viewer" });
    assert.ok(preview);
    const result = await completeInvitationSignup(
      { token: TOKEN, password: "secreto12" },
      {
        preview: async () => preview,
        createConfirmedUser: async () => ({ id: "user-1" }),
        recoverUnconfirmedUser: async () => undefined,
        signIn: async () => undefined,
        accept: async () => ({
          tenant: TENANT_A,
          membership: { role: "viewer", active: true },
          team_member_id: null,
        }),
      }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.membership.role, "viewer");
    assert.equal(result.team_member_id, null);
  });

  it("10. existing confirmed user is asked to sign in, not duplicated", async () => {
    const preview = pendingPreview({
      account_exists: true,
      email_confirmed: true,
    });
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

    const result = await completeInvitationSignup(
      { token: TOKEN, password: "secreto12" },
      {
        preview: async () => preview,
        createConfirmedUser: async () => {
          throw new Error("must not create a duplicate user");
        },
        recoverUnconfirmedUser: async () => {
          throw new Error("must not recover a confirmed user");
        },
        signIn: async () => {
          throw new Error("login stays on the invitation page");
        },
        accept: async () => {
          throw new Error("must not accept before login");
        },
      }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ACCOUNT_EXISTS");
    assert.equal(result.status, 409);
  });

  it("11. a session for another account keeps the token after continue", () => {
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

  it("12. only the specific mismatch code shows the other-account screen", () => {
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
  });

  it("13. another 403 does not show the other-account screen", () => {
    const failure = invitationAcceptFailureView({
      status: 403,
      payload: { error: "Unauthorized or tenant access denied" },
      sessionEmail: OTHER_EMAIL,
      invitedEmail: INVITED_EMAIL,
      returnTo: `/invitations/accept?token=${TOKEN}`,
    });
    assert.equal(failure.kind, "error");
    if (failure.kind !== "error") return;
    assert.match(failure.message, /No tienes acceso|permiso|organización/i);
    assert.equal(failure.message.includes("otra cuenta"), false);
  });

  it("14-18. expired, cancelled, superseded, accepted and invalid tokens stay as errors", () => {
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
        account_exists: false,
        email_confirmed: false,
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

  it("19. client email cannot override the invited email on a valid signup", async () => {
    const preview = pendingPreview();
    assert.ok(preview);
    let createdEmail = "";
    await completeInvitationSignup(
      {
        token: TOKEN,
        password: "secreto12",
        emailFromClient: "manipulado@otro.test",
      },
      {
        preview: async () => preview,
        createConfirmedUser: async (input) => {
          createdEmail = input.email;
          return { id: "user-1" };
        },
        recoverUnconfirmedUser: async () => undefined,
        signIn: async () => undefined,
        accept: async () => ({
          tenant: TENANT_A,
          membership: { role: "staff", active: true },
          team_member_id: "member-1",
        }),
      }
    );
    assert.equal(createdEmail, INVITED_EMAIL);
  });

  it("20. a token only reveals its own tenant and never an auth user id", () => {
    const preview = mapInvitationPreview({
      status: "pending",
      email: INVITED_EMAIL,
      name: "Reservas",
      tenant: TENANT_A,
      account_exists: false,
      email_confirmed: false,
      auth_user_id: "should-stay-server-only",
      role: "staff",
      add_to_personal: true,
    });
    assert.ok(preview);
    assert.equal(preview.tenant?.id, TENANT_A.id);
    assert.notEqual(preview.tenant?.id, TENANT_B.id);
    assert.equal("auth_user_id" in preview, false);
    const publicPreview = toPublicInvitationPreview(preview);
    assert.equal("auth_user_id" in publicPreview, false);
    assert.equal(publicPreview.tenant?.slug, "dj-kaizen");
  });

  it("21. an invitation next path never falls through to onboarding or home", () => {
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

describe("invitation mismatch API code", () => {
  it("maps GTI01 and the SQL message to INVITATION_EMAIL_MISMATCH", () => {
    assert.equal(classifyAccessRpcError("GTI01"), "email_mismatch");
    assert.equal(
      classifyAccessRpcError("42501", "invitation email mismatch"),
      "email_mismatch"
    );
    assert.equal(statusForAccessRpcError("GTI01"), 403);
    assert.equal(publicApiErrorCode("GTI01"), INVITATION_EMAIL_MISMATCH);
    assert.equal(
      publicApiErrorCode("42501", "invitation email mismatch"),
      INVITATION_EMAIL_MISMATCH
    );
    assert.notEqual(publicApiErrorCode("42501", "permission denied"), INVITATION_EMAIL_MISMATCH);
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

describe("unconfirmed leftover from the broken public signup", () => {
  it("recovers an unconfirmed user without sending a second email", async () => {
    const preview = pendingPreview({
      account_exists: true,
      email_confirmed: false,
    });
    assert.ok(preview);
    const view = invitationAcceptView({
      token: TOKEN,
      preview,
      sessionEmail: null,
    });
    assert.equal(view.kind, "signup");

    const plan = planInvitationSignup({
      preview,
      password: "secreto12",
    });
    assert.equal(plan.action, "recover_unconfirmed");
    if (plan.action === "recover_unconfirmed") {
      assert.equal("userId" in plan, false);
      assert.equal(plan.email, INVITED_EMAIL);
    }

    const calls: string[] = [];
    const result = await completeInvitationSignup(
      { token: TOKEN, password: "secreto12" },
      {
        preview: async () => preview,
        createConfirmedUser: async () => {
          throw new Error("must not duplicate");
        },
        recoverUnconfirmedUser: async (input) => {
          calls.push("recover");
          assert.equal(input.token, TOKEN);
          assert.equal(input.email, INVITED_EMAIL);
          assert.equal(input.password, "secreto12");
          assert.equal(input.emailConfirm, true);
        },
        signIn: async () => {
          calls.push("signin");
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
      }
    );
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["recover", "signin", "accept"]);
  });
});
