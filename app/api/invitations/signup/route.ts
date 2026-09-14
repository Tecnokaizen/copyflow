import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseInvitationSignupPayload } from "@/lib/access/payload";
import {
  publicApiErrorCode,
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { mapAcceptInvitationResult } from "@/lib/access/types";
import { completeInvitationSignup } from "@/lib/invitations/complete-signup";
import { ACCOUNT_EXISTS } from "@/lib/invitations/copy";
import { mapInvitationPreview } from "@/lib/invitations/preview";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "La invitación no es válida." },
      { status: 400 }
    );
  }

  const parsed = parseInvitationSignupPayload(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Revisa la contraseña e inténtalo de nuevo." },
      { status: 400 }
    );
  }

  const emailFromClient =
    body && typeof body === "object" && "email" in body
      ? (body as { email?: unknown }).email
      : undefined;

  const supabase = await createClient();
  let admin;

  try {
    admin = createAdminClient();
  } catch {
    console.error("[POST /api/invitations/signup] missing service role");
    return NextResponse.json(
      { error: "No se pudo crear la cuenta." },
      { status: 500 }
    );
  }

  try {
    const result = await completeInvitationSignup(
      {
        token: parsed.token,
        password: parsed.password,
        emailFromClient,
      },
      {
        preview: async (token) => {
          const { data, error } = await supabase.rpc(
            "preview_tenant_invitation",
            { p_token: token }
          );
          if (error || !data) {
            return null;
          }
          return mapInvitationPreview(data);
        },
        createConfirmedUser: async (input) => {
          const { data, error } = await admin.auth.admin.createUser({
            email: input.email,
            password: input.password,
            email_confirm: input.emailConfirm,
            user_metadata: input.name
              ? { full_name: input.name, name: input.name }
              : undefined,
          });
          if (error || !data.user) {
            throw error ?? new Error("Could not create user");
          }
          return { id: data.user.id };
        },
        recoverUnconfirmedUser: async (input) => {
          const { error } = await admin.auth.admin.updateUserById(input.userId, {
            password: input.password,
            email_confirm: input.emailConfirm,
          });
          if (error) {
            throw error;
          }
        },
        signIn: async (input) => {
          const { error } = await supabase.auth.signInWithPassword({
            email: input.email,
            password: input.password,
          });
          if (error) {
            throw error;
          }
        },
        accept: async (token) => {
          const { data, error } = await supabase.rpc(
            "accept_tenant_invitation",
            { p_token: token }
          );
          if (error || !data) {
            const err = new Error(
              publicMessageForAccessRpcError(
                error?.code,
                error?.message,
                "No se pudo aceptar la invitación."
              )
            ) as Error & { status?: number; code?: string };
            err.status = statusForAccessRpcError(error?.code, error?.message);
            err.code = publicApiErrorCode(error?.code, error?.message);
            throw err;
          }
          const mapped = mapAcceptInvitationResult(data);
          if (!mapped) {
            throw new Error("No se pudo aceptar la invitación.");
          }
          return {
            tenant: mapped.tenant,
            membership: mapped.membership,
            team_member_id: mapped.team_member_id ?? null,
          };
        },
      }
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      );
    }

    return NextResponse.json({
      tenant_origin: result.tenant_origin,
      membership: result.membership,
      team_member_id: result.team_member_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/already been registered|already registered|user already/i.test(message)) {
      return NextResponse.json(
        {
          error: "Ya tienes una cuenta. Inicia sesión para continuar.",
          code: ACCOUNT_EXISTS,
        },
        { status: 409 }
      );
    }

    const status =
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 500;
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;

    console.error("[POST /api/invitations/signup] failed", {
      status,
      code,
      message,
    });

    return NextResponse.json(
      {
        error:
          status >= 500
            ? "No se pudo crear la cuenta."
            : message || "No se pudo crear la cuenta.",
        ...(code ? { code } : {}),
      },
      { status }
    );
  }
}
