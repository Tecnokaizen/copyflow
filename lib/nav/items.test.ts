import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessCounter,
  canUseQuickOrder,
  homePathForRole,
  isNavItemVisible,
  navItemIsActive,
  navItemsForRole,
} from "./items";

function labels(role: string | null) {
  return navItemsForRole(role).map((item) => item.label);
}

describe("staff and management navigation", () => {
  it("1. owner keeps the full navigation plus Mostrador and Pedido rápido", () => {
    assert.deepEqual(labels("owner"), [
      "Inicio",
      "Mis pedidos",
      "Mostrador",
      "Pedido rápido",
      "Pedidos",
      "Clientes",
      "Servicios",
      "Equipo",
      "Actividad",
      "Configuración",
    ]);
  });

  it("2. admin keeps operative navigation but cannot access Configuración", () => {
    assert.equal(labels("admin").includes("Configuración"), false);
    assert.equal(isNavItemVisible("settings", "admin"), false);
  });

  it("3. manager keeps operative navigation including Equipo and Actividad", () => {
    assert.deepEqual(labels("manager"), labels("admin"));
    assert.equal(isNavItemVisible("team", "manager"), true);
    assert.equal(isNavItemVisible("activity", "manager"), true);
    assert.equal(isNavItemVisible("settings", "manager"), false);
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
      "Pedidos",
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

  it("highlights Pedido rápido without marking Pedidos", () => {
    assert.equal(
      navItemIsActive(
        { id: "quick", href: "/orders/quick", label: "Pedido rápido" },
        "/orders/quick"
      ),
      true
    );
    assert.equal(
      navItemIsActive(
        { id: "orders", href: "/orders", label: "Pedidos" },
        "/orders/quick"
      ),
      false
    );
    assert.equal(
      navItemIsActive(
        { id: "orders", href: "/orders", label: "Pedidos" },
        "/orders/abc"
      ),
      true
    );
  });

  it("highlights only the owner settings route", () => {
    assert.equal(
      navItemIsActive(
        {
          id: "settings",
          href: "/settings/quick-order",
          label: "Configuración",
        },
        "/settings/quick-order"
      ),
      true
    );
    assert.equal(isNavItemVisible("settings", "owner"), true);
  });
});
