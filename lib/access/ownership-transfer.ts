export const OWNERSHIP_TRANSFER_CONFIRMATION = "TRANSFERIR";

export function canTransferTenantOwnership(
  actorRole: string | null | undefined,
  target: { role: string; active: boolean }
) {
  return actorRole === "owner" && target.active && target.role !== "owner";
}
export function ownershipTransferTargetLabel(target: {
  full_name: string | null;
  email: string | null;
}) {
  return target.full_name || target.email || "este usuario";
}
