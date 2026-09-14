export const PERSONAL_STATUS_LINKED = "En Personal";
export const PERSONAL_STATUS_UNLINKED = "Sin ficha de Personal";
export const INVITE_ADD_TO_PERSONAL_HELP =
  "Crea también su ficha en Personal para poder asignarle pedidos y utilizar Mis pedidos.";
export const DEFAULT_INVITE_ADD_TO_PERSONAL = true;

export function personalStatusLabel(
  member: { id: string; name: string } | null | undefined
) {
  return member ? PERSONAL_STATUS_LINKED : PERSONAL_STATUS_UNLINKED;
}

export function personalLinkActionLabel(linked: boolean) {
  return linked ? "Cambiar ficha" : "Vincular con Personal";
}

export type AcceptedPersonalCardPlan =
  | { action: "none" }
  | {
      action: "create";
      name: string;
      email: string;
      active: true;
      canReceiveOrders: true;
    };

/**
 * Mirrors accept_tenant_invitation Personal-card rules.
 * Never matches an existing unlinked team_member by email.
 */
export function planAcceptedPersonalCard(input: {
  addToPersonal: boolean;
  invitationName: string | null;
  profileName: string | null;
  email: string;
  existingLinkedMemberId: string | null;
  unlinkedMemberIdWithSameEmail?: string | null;
}): AcceptedPersonalCardPlan {
  void input.unlinkedMemberIdWithSameEmail;

  if (!input.addToPersonal || input.existingLinkedMemberId) {
    return { action: "none" };
  }

  const invitationName = input.invitationName?.trim() || "";
  const profileName = input.profileName?.trim() || "";
  const emailLocal = input.email.split("@")[0]?.trim() || "";
  const name = invitationName || profileName || emailLocal;

  if (!name) {
    return { action: "none" };
  }

  return {
    action: "create",
    name,
    email: input.email.trim().toLowerCase(),
    active: true,
    canReceiveOrders: true,
  };
}
