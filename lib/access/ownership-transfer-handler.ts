import { parseOwnershipTransferPayload } from "@/lib/access/ownership-transfer";
import {
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { unwrapRpcPayload } from "@/lib/access/types";

export type OwnershipTransferActor = {
  actorUserId: string;
  tenantId: string;
  role: string;
};

export type OwnershipTransferRpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

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

export async function runOwnershipTransfer(input: {
  context: OwnershipTransferActor | null;
  rawBody: string;
  transfer: (args: {
    tenantId: string;
    targetUserId: string;
  }) => Promise<OwnershipTransferRpcResult>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.context || input.context.role !== "owner") {
    return {
      status: 403,
      body: { error: "Unauthorized or tenant access denied" },
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "Invalid value" } };
  }

  const parsed = parseOwnershipTransferPayload(body);
  if (!parsed.ok) {
    return { status: 400, body: { error: "Invalid value" } };
  }

  const { data, error } = await input.transfer({
    tenantId: input.context.tenantId,
    targetUserId: parsed.targetUserId,
  });

  if (error || data == null) {
    return {
      status: statusForAccessRpcError(error?.code, error?.message),
      body: {
        error: publicMessageForAccessRpcError(
          error?.code,
          error?.message,
          "Could not transfer ownership"
        ),
      },
    };
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
    previousOwner.user_id !== input.context.actorUserId
  ) {
    return { status: 500, body: { error: "Could not transfer ownership" } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      previous_owner: previousOwner,
      new_owner: newOwner,
    },
  };
}
