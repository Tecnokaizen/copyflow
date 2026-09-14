import { linkDecisionStatus } from "@/lib/team/resolve-link";

export function statusForTeamRpcError(
  code: string | undefined,
  message?: string
) {
  const classified = classifyTeamMemberWriteError(code, message);
  if (classified) {
    return classified.status;
  }

  switch (code) {
    case "28000":
      return 401;
    case "42501":
      return 403;
    case "22023":
      return 400;
    case "P0002":
      return 404;
    default:
      return 500;
  }
}

export function classifyTeamMemberWriteError(
  code: string | undefined,
  message?: string
): { status: number; code: string } | null {
  const normalized = (message ?? "").toLowerCase();

  if (code === "23505" || normalized.includes("already_linked")) {
    return { status: linkDecisionStatus("already_linked"), code: "already_linked" };
  }

  if (normalized.includes("membership_inactive")) {
    return {
      status: linkDecisionStatus("membership_inactive"),
      code: "membership_inactive",
    };
  }

  if (code === "23503" || normalized.includes("membership_missing")) {
    return {
      status: linkDecisionStatus("membership_missing"),
      code: "membership_missing",
    };
  }

  if (normalized.includes("tenant_mismatch")) {
    return {
      status: linkDecisionStatus("tenant_mismatch"),
      code: "tenant_mismatch",
    };
  }

  return null;
}
