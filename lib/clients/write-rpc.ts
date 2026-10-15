type RpcResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
};

/** The Supabase session client satisfies this; tests pass a fake. */
type RpcCaller = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

/** The v2 RPCs are not in the database yet (migration 20261016100000 pending). */
export const CLIENT_ADDRESS_UNAVAILABLE = "CLIENT_ADDRESS_UNAVAILABLE";

function functionMissing(error: RpcResult["error"]) {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/**
 * Create or update a client, with the optional address (#101).
 *
 * - address undefined (not sent): v1 RPC, stored address untouched.
 * - create without address: v1 RPC (no dependency on the migration).
 * - otherwise: v2 RPC in one transaction. If v2 does not exist yet and there
 *   is no address to store, fall back to v1 so the deploy order of code and
 *   migration does not break client creation/editing; with an address, report
 *   CLIENT_ADDRESS_UNAVAILABLE instead of silently dropping it.
 */
export async function writeClient(
  supabase: RpcCaller,
  kind: "create" | "update",
  args: Record<string, unknown>,
  address: string | null | undefined
): Promise<RpcResult> {
  const v1 = kind === "create" ? "create_client" : "update_client";
  if (address === undefined || (kind === "create" && address === null)) {
    return supabase.rpc(v1, args);
  }

  const result = await supabase.rpc(`${v1}_v2`, {
    ...args,
    p_address: address,
  });
  if (!functionMissing(result.error)) {
    return result;
  }
  if (address === null) {
    return supabase.rpc(v1, args);
  }
  return {
    data: null,
    error: { code: CLIENT_ADDRESS_UNAVAILABLE, message: "client address not available yet" },
  };
}
