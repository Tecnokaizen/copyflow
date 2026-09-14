import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MINE_ORDERS_PAGE_DESCRIPTION,
  UNLINKED_MINE_ASSIGN_CTA_HREF,
  UNLINKED_MINE_ASSIGN_CTA_LABEL,
  unlinkedMineOrdersCopy,
} from "./mine-unlinked-copy";

const FORBIDDEN = [
  "vínculo",
  "vinculado",
  "vincule",
  "team_member",
  "membership",
  "ficha de personal",
];

describe("unlinkedMineOrdersCopy", () => {
  it("keeps the page subtitle operational, not diagnostic", () => {
    assert.equal(
      MINE_ORDERS_PAGE_DESCRIPTION,
      "Aquí verás los pedidos que tengas asignados."
    );
  });

  it("explains the empty state without implying a misconfiguration", () => {
    const copy = unlinkedMineOrdersCopy(null);
    assert.equal(copy.title, "No tienes un perfil operativo asignado");
    assert.equal(
      copy.description,
      "Mis pedidos solo se utiliza cuando tu usuario corresponde a un miembro del equipo que recibe pedidos."
    );
    assert.equal(copy.hint, null);
    assert.equal(copy.assignCtaHref, null);
  });

  it("tells owner, admin and manager how to associate their user, with CTA only where access exists", () => {
    const owner = unlinkedMineOrdersCopy("owner");
    const admin = unlinkedMineOrdersCopy("admin");
    const manager = unlinkedMineOrdersCopy("manager");

    for (const copy of [owner, admin, manager]) {
      assert.equal(
        copy.hint,
        "Si también trabajas pedidos, puedes asociar tu usuario a un miembro del equipo desde Equipo → Usuarios y permisos."
      );
    }

    assert.equal(owner.assignCtaHref, UNLINKED_MINE_ASSIGN_CTA_HREF);
    assert.equal(admin.assignCtaHref, UNLINKED_MINE_ASSIGN_CTA_HREF);
    assert.equal(manager.assignCtaHref, null);
    assert.equal(UNLINKED_MINE_ASSIGN_CTA_HREF, "/team/access");
    assert.equal(UNLINKED_MINE_ASSIGN_CTA_LABEL, "Asignar perfil operativo");
  });

  it("tells staff and viewer to ask an administrator", () => {
    for (const role of ["staff", "viewer"] as const) {
      const copy = unlinkedMineOrdersCopy(role);
      assert.equal(
        copy.hint,
        "Pide a un administrador que asocie tu usuario a tu perfil operativo."
      );
      assert.equal(copy.assignCtaHref, null);
    }
  });

  it("avoids internal jargon in user-facing copy", () => {
    const samples = [
      MINE_ORDERS_PAGE_DESCRIPTION,
      ...["owner", "manager", "staff", null].map((role) => {
        const copy = unlinkedMineOrdersCopy(role);
        return [copy.title, copy.description, copy.hint ?? ""].join(" ");
      }),
    ].join(" ");

    const haystack = samples.toLowerCase();
    for (const term of FORBIDDEN) {
      assert.equal(haystack.includes(term), false, `found forbidden term: ${term}`);
    }
  });
});
