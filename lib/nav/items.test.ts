import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessCounter,
  canUseQuickOrder,
  homePathForRole,
  isNavItemVisible,
  navGroupIsActive,
  navItemIsActive,
  navItemsForRole,
  navStructureForRole,
} from "./items";

function labels(role: string | null) {
  return navItemsForRole(role).map((item) => item.label);
}

function groupLabels(role: string | null) {
  return navStructureForRole(role).map((entry) =>
    entry.type === "link" ? entry.item.label : entry.group.label
  );
}

function groupChildLabels(role: string | null, groupId: string) {
  const entry = navStructureForRole(role).find(
    (row) => row.type === "group" && row.group.id === groupId
  );
  if (!entry || entry.type !== "group") return [];
  return entry.group.items.map((item) => item.label);
}

describe("staff and management navigation", () => {
  it("1. owner keeps the full navigation plus Mostrador and Pedido rápido", () => {
    assert.deepEqual(labels("owner"), [
      "Inicio",
      "Mis pedidos",
      "Mostrador",
      "Pedido rápido",
      "Todos los pedidos",
      "Archivados",
      "Clientes",
      "Servicios",
      "Equipo",
      "Actividad",
      "Configuración",
    ]);
  });

  it("2. admin keeps operative navigation and can access catalog settings", () => {
    assert.equal(labels("admin").includes("Configuración"), true);
    assert.equal(isNavItemVisible("settings", "admin"), true);
  });

  it("3. manager keeps operative navigation including Equipo, Actividad and Configuración", () => {
    assert.deepEqual(labels("manager"), labels("admin"));
    assert.equal(isNavItemVisible("team", "manager"), true);
    assert.equal(isNavItemVisible("activity", "manager"), true);
    assert.equal(isNavItemVisible("settings", "manager"), true);
  });

  it("4. staff sees a simplified work navigation", () => {
    assert.deepEqual(labels("staff"), [
      "Mis pedidos",
      "Mostrador",
      "Pedido rápido",
      "Clientes",
    ]);
    assert.equal(isNavItemVisible("home", "staff"), false);
    assert.equal(isNavItemVisible("orders", "staff"), false);
    assert.equal(isNavItemVisible("archived", "staff"), false);
    assert.equal(isNavItemVisible("services", "staff"), false);
    assert.equal(isNavItemVisible("team", "staff"), false);
    assert.equal(isNavItemVisible("activity", "staff"), false);
    assert.equal(isNavItemVisible("settings", "staff"), false);
    assert.equal(homePathForRole("staff"), "/orders/mine");
  });

  it("5. viewer does not see Pedido rápido or Equipo", () => {
    assert.equal(isNavItemVisible("quick", "viewer"), false);
    assert.equal(canUseQuickOrder("viewer"), false);
    assert.equal(isNavItemVisible("team", "viewer"), false);
    assert.equal(isNavItemVisible("settings", "viewer"), false);
    assert.equal(isNavItemVisible("counter", "viewer"), true);
    assert.equal(canAccessCounter("viewer"), true);
    assert.deepEqual(labels("viewer"), [
      "Inicio",
      "Mis pedidos",
      "Mostrador",
      "Todos los pedidos",
      "Archivados",
      "Clientes",
      "Servicios",
    ]);
  });

  it("6-8. staff can open Mis pedidos, Mostrador and Pedido rápido", () => {
    assert.equal(isNavItemVisible("mine", "staff"), true);
    assert.equal(isNavItemVisible("counter", "staff"), true);
    assert.equal(canUseQuickOrder("staff"), true);
    assert.equal(homePathForRole("owner"), "/");
    assert.equal(homePathForRole("manager"), "/");
  });

  it("highlights Pedido rápido without marking Todos los pedidos", () => {
    assert.equal(
      navItemIsActive(
        { id: "quick", href: "/orders/quick", label: "Pedido rápido" },
        "/orders/quick"
      ),
      true
    );
    assert.equal(
      navItemIsActive(
        {
          id: "orders",
          href: "/orders?view=list&filter=all",
          label: "Todos los pedidos",
        },
        "/orders/quick"
      ),
      false
    );
    assert.equal(
      navItemIsActive(
        {
          id: "orders",
          href: "/orders?view=list&filter=all",
          label: "Todos los pedidos",
        },
        "/orders/abc"
      ),
      false
    );
  });

  it("highlights only the owner settings route", () => {
    assert.equal(
      navItemIsActive(
        {
          id: "settings",
          href: "/settings",
          label: "Configuración",
        },
        "/settings"
      ),
      true
    );
    assert.equal(
      navItemIsActive(
        {
          id: "settings",
          href: "/settings",
          label: "Configuración",
        },
        "/settings/quick-order"
      ),
      true
    );
    assert.equal(isNavItemVisible("settings", "owner"), true);
  });
});

describe("nav structure groups", () => {
  it("groups Pedidos / Gestión / Administración with expected children", () => {
    assert.deepEqual(groupLabels("owner"), [
      "Inicio",
      "Pedidos",
      "Clientes",
      "Gestión",
      "Administración",
    ]);
    assert.deepEqual(groupChildLabels("owner", "orders"), [
      "Mostrador",
      "Todos los pedidos",
      "Mis pedidos",
      "Pedido rápido",
      "Archivados",
    ]);
    assert.deepEqual(groupChildLabels("owner", "management"), [
      "Servicios",
      "Equipo",
    ]);
    assert.deepEqual(groupChildLabels("owner", "admin"), [
      "Actividad",
      "Configuración",
    ]);
    assert.deepEqual(groupChildLabels("manager", "admin"), [
      "Actividad",
      "Configuración",
    ]);
  });

  it("omits empty groups for staff", () => {
    assert.deepEqual(groupLabels("staff"), ["Pedidos", "Clientes"]);
    assert.deepEqual(groupChildLabels("staff", "orders"), [
      "Mostrador",
      "Mis pedidos",
      "Pedido rápido",
    ]);
    assert.equal(groupChildLabels("staff", "management").length, 0);
    assert.equal(groupChildLabels("staff", "admin").length, 0);
  });

  it("marks Pedidos group active independently of Todos child", () => {
    const ordersGroup = navStructureForRole("owner").find(
      (entry) => entry.type === "group" && entry.group.id === "orders"
    );
    assert.ok(ordersGroup && ordersGroup.type === "group");

    const archivedItem = ordersGroup.group.items.find(
      (item) => item.id === "archived"
    );
    const allOrdersItem = ordersGroup.group.items.find(
      (item) => item.id === "orders"
    );
    assert.ok(archivedItem && allOrdersItem);
    assert.equal(
      allOrdersItem.href,
      "/orders?view=list&filter=all"
    );

    assert.equal(navGroupIsActive(ordersGroup.group, "/counter"), true);
    assert.equal(navGroupIsActive(ordersGroup.group, "/orders"), true);
    assert.equal(navGroupIsActive(ordersGroup.group, "/orders/abc"), true);
    assert.equal(navGroupIsActive(ordersGroup.group, "/orders/mine"), true);
    assert.equal(navGroupIsActive(ordersGroup.group, "/orders/quick"), true);
    assert.equal(
      navGroupIsActive(ordersGroup.group, {
        pathname: "/orders",
        searchParams: new URLSearchParams("filter=active"),
      }),
      true
    );
    assert.equal(
      navGroupIsActive(ordersGroup.group, {
        pathname: "/orders",
        searchParams: new URLSearchParams("view=list&filter=archived"),
      }),
      true
    );

    assert.equal(
      navItemIsActive(allOrdersItem, {
        pathname: "/orders",
        searchParams: new URLSearchParams("view=list&filter=all"),
      }),
      true
    );
    assert.equal(
      navItemIsActive(archivedItem, {
        pathname: "/orders",
        searchParams: new URLSearchParams("filter=archived"),
      }),
      true
    );
    assert.equal(
      navItemIsActive(allOrdersItem, {
        pathname: "/orders",
        searchParams: new URLSearchParams("filter=archived"),
      }),
      false
    );
    assert.equal(
      navItemIsActive(allOrdersItem, {
        pathname: "/orders",
        searchParams: new URLSearchParams("filter=active"),
      }),
      false
    );
    assert.equal(
      navItemIsActive(allOrdersItem, {
        pathname: "/orders",
        searchParams: new URLSearchParams("filter=urgent"),
      }),
      false
    );
    assert.equal(
      navItemIsActive(allOrdersItem, { pathname: "/orders" }),
      false
    );
    assert.equal(
      navItemIsActive(allOrdersItem, { pathname: "/orders/abc" }),
      false
    );
  });

  it("Archivados uses the same gate as Todos los pedidos", () => {
    for (const role of ["owner", "admin", "manager", "viewer", "staff"] as const) {
      assert.equal(
        isNavItemVisible("archived", role),
        isNavItemVisible("orders", role)
      );
    }
  });
});
