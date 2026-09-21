import {
  canManageSettingsCatalogs,
  canViewActivity,
  canWriteOrders,
  canWriteTeam,
} from "@/lib/auth/membership-roles";

export type AppNavItemId =
  | "home"
  | "mine"
  | "counter"
  | "quick"
  | "orders"
  | "archived"
  | "clients"
  | "services"
  | "team"
  | "activity"
  | "settings";

export type AppNavGroupId = "orders" | "management" | "admin";

export type AppNavItem = {
  id: AppNavItemId;
  href: string;
  label: string;
};

export type AppNavGroup = {
  id: AppNavGroupId;
  label: string;
  items: AppNavItem[];
};

export type AppNavEntry =
  | { type: "link"; item: AppNavItem }
  | { type: "group"; group: AppNavGroup };

const NAV_BY_ID: Record<AppNavItemId, AppNavItem> = {
  home: { id: "home", href: "/", label: "Inicio" },
  counter: { id: "counter", href: "/counter", label: "Mostrador" },
  orders: {
    id: "orders",
    href: "/orders?view=list&filter=all",
    label: "Todos los pedidos",
  },
  mine: { id: "mine", href: "/orders/mine", label: "Mis pedidos" },
  quick: { id: "quick", href: "/orders/quick", label: "Pedido rápido" },
  archived: {
    id: "archived",
    href: "/orders?view=list&filter=archived",
    label: "Archivados",
  },
  clients: { id: "clients", href: "/clients", label: "Clientes" },
  services: { id: "services", href: "/services", label: "Servicios" },
  team: { id: "team", href: "/team", label: "Equipo" },
  activity: { id: "activity", href: "/activity", label: "Actividad" },
  settings: {
    id: "settings",
    href: "/settings",
    label: "Configuración",
  },
};

/** Flat catalog order used by role visibility tests and legacy helpers. */
const NAV_CATALOG: AppNavItem[] = [
  NAV_BY_ID.home,
  NAV_BY_ID.mine,
  NAV_BY_ID.counter,
  NAV_BY_ID.quick,
  NAV_BY_ID.orders,
  NAV_BY_ID.archived,
  NAV_BY_ID.clients,
  NAV_BY_ID.services,
  NAV_BY_ID.team,
  NAV_BY_ID.activity,
  NAV_BY_ID.settings,
];

const ORDERS_GROUP_IDS: AppNavItemId[] = [
  "counter",
  "orders",
  "mine",
  "quick",
  "archived",
];
const MANAGEMENT_GROUP_IDS: AppNavItemId[] = ["services", "team"];
const ADMIN_GROUP_IDS: AppNavItemId[] = ["activity", "settings"];

export function canAccessCounter(role: string | null | undefined) {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "manager" ||
    role === "staff" ||
    role === "viewer"
  );
}

export function canUseQuickOrder(role: string | null | undefined) {
  return canWriteOrders(role);
}

export function homePathForRole(role: string | null | undefined) {
  if (role === "staff") {
    return "/orders/mine";
  }
  return "/";
}

export function isNavItemVisible(
  id: AppNavItemId,
  role: string | null | undefined
) {
  switch (id) {
    case "home":
      return role !== "staff";
    case "mine":
    case "clients":
      return true;
    case "counter":
      return canAccessCounter(role);
    case "quick":
      return canUseQuickOrder(role);
    case "orders":
    case "archived":
      return role !== "staff";
    case "services":
      return role !== "staff";
    case "team":
      return canWriteTeam(role);
    case "activity":
      return canViewActivity(role);
    case "settings":
      return canManageSettingsCatalogs(role);
    default:
      return false;
  }
}

export function navItemsForRole(role: string | null | undefined): AppNavItem[] {
  return NAV_CATALOG.filter((item) => isNavItemVisible(item.id, role));
}

function visibleItems(
  ids: AppNavItemId[],
  role: string | null | undefined
): AppNavItem[] {
  return ids
    .filter((id) => isNavItemVisible(id, role))
    .map((id) => NAV_BY_ID[id]);
}

/**
 * Grouped navigation for Top/Nav V2. Empty groups are omitted.
 * Desktop and mobile must both use this structure.
 */
export function navStructureForRole(
  role: string | null | undefined
): AppNavEntry[] {
  const entries: AppNavEntry[] = [];

  if (isNavItemVisible("home", role)) {
    entries.push({ type: "link", item: NAV_BY_ID.home });
  }

  const ordersItems = visibleItems(ORDERS_GROUP_IDS, role);
  if (ordersItems.length > 0) {
    entries.push({
      type: "group",
      group: { id: "orders", label: "Pedidos", items: ordersItems },
    });
  }

  if (isNavItemVisible("clients", role)) {
    entries.push({ type: "link", item: NAV_BY_ID.clients });
  }

  const managementItems = visibleItems(MANAGEMENT_GROUP_IDS, role);
  if (managementItems.length > 0) {
    entries.push({
      type: "group",
      group: {
        id: "management",
        label: "Gestión",
        items: managementItems,
      },
    });
  }

  const adminItems = visibleItems(ADMIN_GROUP_IDS, role);
  if (adminItems.length > 0) {
    entries.push({
      type: "group",
      group: { id: "admin", label: "Administración", items: adminItems },
    });
  }

  return entries;
}

export type NavLocation = {
  pathname: string;
  searchParams?: URLSearchParams | { get: (key: string) => string | null };
};

function filterParam(location: NavLocation): string | null {
  return location.searchParams?.get("filter") ?? null;
}

export function navItemIsActive(item: AppNavItem, location: NavLocation | string) {
  const normalized: NavLocation =
    typeof location === "string" ? { pathname: location } : location;
  const pathname = normalized.pathname;
  const filter = filterParam(normalized);

  if (item.id === "home") {
    return pathname === "/";
  }
  if (item.id === "mine") {
    return pathname === "/orders/mine" || pathname.startsWith("/orders/mine/");
  }
  if (item.id === "counter") {
    return pathname === "/counter" || pathname.startsWith("/counter/");
  }
  if (item.id === "quick") {
    return pathname === "/orders/quick" || pathname.startsWith("/orders/quick/");
  }
  if (item.id === "archived") {
    return pathname === "/orders" && filter === "archived";
  }
  if (item.id === "orders") {
    return pathname === "/orders" && filter === "all";
  }
  if (item.id === "clients") {
    return pathname === "/clients" || pathname.startsWith("/clients/");
  }
  if (item.id === "services") {
    return pathname === "/services";
  }
  if (item.id === "team") {
    return pathname === "/team" || pathname.startsWith("/team/");
  }
  if (item.id === "activity") {
    return pathname === "/activity";
  }
  if (item.id === "settings") {
    return pathname === "/settings" || pathname.startsWith("/settings/");
  }
  return false;
}

/** True when the current location belongs to the Pedidos domain. */
export function isOrdersDomainActive(location: NavLocation | string) {
  const normalized: NavLocation =
    typeof location === "string" ? { pathname: location } : location;
  const pathname = normalized.pathname;

  if (pathname === "/counter" || pathname.startsWith("/counter/")) {
    return true;
  }

  if (pathname === "/orders" || pathname.startsWith("/orders/")) {
    return true;
  }

  return false;
}

export function navGroupIsActive(
  group: AppNavGroup,
  location: NavLocation | string
) {
  if (group.id === "orders") {
    return isOrdersDomainActive(location);
  }

  return group.items.some((item) => navItemIsActive(item, location));
}
