import { NextRequest, NextResponse } from "next/server";
import { parseOwnershipTransferPayload } from "@/lib/access/ownership-transfer";
import {
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { unwrapRpcPayload } from "@/lib/access/types";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function memberFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.user_id !== "string" || typeof record.role !== "string") {
    return null;
  }
  return {
    user_id: record.user_id,
    role: record.role,
    active: record.active === true,
  };
}

export async function POST(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context || context.membership.role !== "owner") {
    return json({ error: "Unauthorized or tenant access denied" }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid value" }, 400);
  }

  const parsed = parseOwnershipTransferPayload(body);
  if (!parsed.ok) {
    return json({ error: "Invalid value" }, 400);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transfer_tenant_ownership", {
    p_tenant_id: context.tenant.id,
    p_target_user_id: parsed.targetUserId,
  });

  if (error || data == null) {
    console.error("[POST /api/team/access/transfer-ownership] failed", {
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      code: error?.code,
    });
    return json(
      {
        error: publicMessageForAccessRpcError(
          error?.code,
          error?.message,
          "Could not transfer ownership"
        ),
      },
      statusForAccessRpcError(error?.code, error?.message)
    );
  }

  const record = unwrapRpcPayload(data);
  const previousOwner = memberFrom(record.previous_owner);
  const newOwner = memberFrom(record.new_owner);

  if (
    !previousOwner ||
    !newOwner ||
    previousOwner.role !== "admin" ||
    newOwner.role !== "owner" ||
    newOwner.user_id !== parsed.targetUserId ||
    previousOwner.user_id !== context.user.id
  ) {
    console.error("[POST /api/team/access/transfer-ownership] unexpected payload", {
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
    });
    return json({ error: "Could not transfer ownership" }, 500);
  }

  return json({
    ok: true,
    previous_owner: previousOwner,
    new_owner: newOwner,
  });
}
