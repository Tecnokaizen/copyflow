export const MINE_ORDERS_PAGE_DESCRIPTION =
  "Aquí verás los pedidos que tengas asignados.";

export const UNLINKED_MINE_TITLE = "No tienes una ficha de Personal asociada";

export const UNLINKED_MINE_DESCRIPTION =
  "Puedes usar Gestcopy con normalidad. Solo necesitas una ficha de Personal vinculada para utilizar Mis pedidos.";

export const UNLINKED_MINE_ASSIGN_CTA_LABEL = "Vincular con Personal";
export const UNLINKED_MINE_ASSIGN_CTA_ACCESS_HREF = "/team/access";
export const UNLINKED_MINE_ASSIGN_CTA_TEAM_HREF = "/team";

export type UnlinkedMineOrdersCopy = {
  title: string;
  description: string;
  assignCtaHref: string | null;
};

export function unlinkedMineOrdersCopy(options: {
  canWriteTeam: boolean;
  canManageTenantAccess: boolean;
}): UnlinkedMineOrdersCopy {
  const assignCtaHref = options.canManageTenantAccess
    ? UNLINKED_MINE_ASSIGN_CTA_ACCESS_HREF
    : options.canWriteTeam
      ? UNLINKED_MINE_ASSIGN_CTA_TEAM_HREF
      : null;

  return {
    title: UNLINKED_MINE_TITLE,
    description: UNLINKED_MINE_DESCRIPTION,
    assignCtaHref,
  };
}
