import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { personalLinkActionLabel } from "@/lib/access/invitation-personal";
import {
  PERSONAL_HAS_ACCESS_LABEL,
  PERSONAL_NO_ACCESS_LABEL,
  personalAccessActionLabel,
  personalAccessModalTitle,
} from "./access-copy";

describe("Personal access copy", () => {
  it("keeps Con acceso / Sin acceso badges and only changes the action labels", () => {
    assert.equal(PERSONAL_HAS_ACCESS_LABEL, "Con acceso");
    assert.equal(PERSONAL_NO_ACCESS_LABEL, "Sin acceso");
    assert.equal(personalAccessActionLabel(false), "Dar acceso");
    assert.equal(personalAccessActionLabel(true), "Cambiar acceso");
    assert.equal(personalAccessModalTitle(false), "Dar acceso");
    assert.equal(personalAccessModalTitle(true), "Cambiar acceso");
  });

  it("does not change the inverse Usuarios → Personal labels", () => {
    assert.equal(personalLinkActionLabel(false), "Vincular con Personal");
    assert.equal(personalLinkActionLabel(true), "Cambiar ficha");
  });
});
