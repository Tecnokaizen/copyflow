import {
  MANAGEMENT_ROLES,
  canManageTenantAccess,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";

export const MINE_ORDERS_PAGE_DESCRIPTION =
  "Aquí verás los pedidos que tengas asignados.";

export const UNLINKED_MINE_TITLE = "No tienes un perfil operativo asignado";

export const UNLINKED_MINE_DESCRIPTION =
  "Mis pedidos solo se utiliza cuando tu usuario corresponde a un miembro del equipo que recibe pedidos.";

export const UNLINKED_MINE_MANAGEMENT_HINT =
  "Si también trabajas pedidos, puedes asociar tu usuario a un miembro del equipo desde Equipo → Usuarios y permisos.";

export const UNLINKED_MINE_STAFF_HINT =
  "Pide a un administrador que asocie tu usuario a tu perfil operativo.";

export const UNLINKED_MINE_ASSIGN_CTA_LABEL = "Asignar perfil operativo";

export const UNLINKED_MINE_ASSIGN_CTA_HREF = "/team/access";

export type UnlinkedMineOrdersCopy = {
  title: string;
  description: string;
  hint: string | null;
  assignCtaHref: string | null;
};

export function unlinkedMineOrdersCopy(
  role: string | null | undefined
): UnlinkedMineOrdersCopy {
  if (hasMembershipRole(role, MANAGEMENT_ROLES)) {
    return {
      title: UNLINKED_MINE_TITLE,
      description: UNLINKED_MINE_DESCRIPTION,
      hint: UNLINKED_MINE_MANAGEMENT_HINT,
      assignCtaHref: canManageTenantAccess(role)
        ? UNLINKED_MINE_ASSIGN_CTA_HREF
        : null,
    };
  }

  if (role == null || role === "") {
    return {
      title: UNLINKED_MINE_TITLE,
      description: UNLINKED_MINE_DESCRIPTION,
      hint: null,
      assignCtaHref: null,
    };
  }

  return {
    title: UNLINKED_MINE_TITLE,
    description: UNLINKED_MINE_DESCRIPTION,
    hint: UNLINKED_MINE_STAFF_HINT,
    assignCtaHref: null,
  };
}
