import {
  canViewActivity,
  canWriteOrders,
  canWriteTeam,
} from "@/lib/auth/membership-roles";
import { canManageQuickOrderLayout } from "@/lib/settings/quick-order-layout";

export type AppNavItemId =
  | "home"
  | "mine"
  | "counter"
  | "quick"
  | "orders"
  | "clients"
  | "services"
  | "team"
  | "activity"
  | "settings";

export type AppNavItem = {
  id: AppNavItemId;
  href: string;
  label: string;
};

const NAV_CATALOG: AppNavItem[] = [
  { id: "home", href: "/", label: "Inicio" },
  { id: "mine", href: "/orders/mine", label: "Mis pedidos" },
  { id: "counter", href: "/counter", label: "Mostrador" },
  { id: "quick", href: "/orders/quick", label: "Pedido rápido" },
  { id: "orders", href: "/orders", label: "Pedidos" },
  { id: "clients", href: "/clients", label: "Clientes" },
  { id: "services", href: "/services", label: "Servicios" },
  { id: "team", href: "/team", label: "Equipo" },
  { id: "activity", href: "/activity", label: "Actividad" },
  {
    id: "settings",
    href: "/settings/quick-order",
    label: "Configuración",
  },
];

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
      return role !== "staff";
    case "services":
      return role !== "staff";
    case "team":
      return canWriteTeam(role);
    case "activity":
      return canViewActivity(role);
    case "settings":
      return canManageQuickOrderLayout(role);
    default:
      return false;
  }
}

export function navItemsForRole(role: string | null | undefined): AppNavItem[] {
  return NAV_CATALOG.filter((item) => isNavItemVisible(item.id, role));
}

export function navItemIsActive(
  item: AppNavItem,
  pathname: string
) {
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
  if (item.id === "orders") {
    return (
      (pathname === "/orders" || pathname.startsWith("/orders/")) &&
      pathname !== "/orders/mine" &&
      !pathname.startsWith("/orders/mine/") &&
      pathname !== "/orders/quick" &&
      !pathname.startsWith("/orders/quick/")
    );
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
    return pathname === "/settings/quick-order";
  }
  return false;
}

