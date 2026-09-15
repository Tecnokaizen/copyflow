export const PERSONAL_HAS_ACCESS_LABEL = "Con acceso";
export const PERSONAL_NO_ACCESS_LABEL = "Sin acceso";

/** Secondary/legacy link from a Personal card to a Gestcopy user. */
export function personalAccessActionLabel(hasAccess: boolean) {
  return hasAccess ? "Cambiar acceso" : "Dar acceso";
}

export function personalAccessModalTitle(hasAccess: boolean) {
  return personalAccessActionLabel(hasAccess);
}
