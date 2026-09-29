import { NextRequest, NextResponse } from "next/server";
import { runOwnershipTransfer } from "@/lib/access/ownership-transfer-handler";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentContext();
  const rawBody = await request.text();

  const result = await runOwnershipTransfer({
    context: context
      ? {
          actorUserId: context.user.id,
          tenantId: context.tenant.id,
          role: context.membership.role,
        }
      : null,
    rawBody,
    transfer: async ({ tenantId, targetUserId }) => {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("transfer_tenant_ownership", {
        p_tenant_id: tenantId,
        p_target_user_id: targetUserId,
      });
      if (error || data == null) {
        console.error("[POST /api/team/access/transfer-ownership] failed", {
          tenantId,
          actorUserId: context?.user.id,
          code: error?.code,
        });
      }
      return { data, error };
    },
  });

  return json(result.body, result.status);
}
