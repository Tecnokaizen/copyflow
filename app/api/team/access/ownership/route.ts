import { NextRequest, NextResponse } from "next/server";
import { parseOwnershipTransferPayload } from "@/lib/access/payload";
import {
  publicMessageForAccessRpcError,
  rpcErrorDigest,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { unwrapRpcPayload } from "@/lib/access/types";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function POST(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context || context.membership.role !== "owner") {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const parsed = parseOwnershipTransferPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transfer_tenant_ownership", {
    p_tenant_id: context.tenant.id,
    p_new_owner_user_id: parsed.newOwnerUserId,
  });

  if (error || !data) {
    const digest = rpcErrorDigest(error);

    console.error("[POST /api/team/access/ownership] transfer failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      targetUserId: parsed.newOwnerUserId,
      code: digest.code,
      message: digest.message,
    });

    return NextResponse.json(
      {
        error: publicMessageForAccessRpcError(
          digest.code,
          digest.message,
          "Could not transfer tenant ownership"
        ),
        code: digest.code,
      },
      { status: statusForAccessRpcError(digest.code, digest.message) }
    );
  }

  const result = unwrapRpcPayload(data);

  return NextResponse.json({
    ok: true,
    tenant_id:
      typeof result.tenant_id === "string"
        ? result.tenant_id
        : context.tenant.id,
    previous_owner: result.previous_owner ?? null,
    new_owner: result.new_owner ?? null,
  });
}
