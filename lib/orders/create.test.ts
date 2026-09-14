import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveOrderTitle,
  userFacingCreateOrderError,
} from "./create";

describe("deriveOrderTitle", () => {
  it("prefers an explicit title", () => {
    assert.equal(
      deriveOrderTitle({
        title: " Tarjetas  ",
        description: "A4 color",
        serviceName: "Copias",
      }),
      "Tarjetas"
    );
  });

  it("uses the first line of the description when title is empty", () => {
    assert.equal(
      deriveOrderTitle({
        title: "  ",
        description: "50 tarjetas a color\ncon barniz",
        serviceName: "Copias",
      }),
      "50 tarjetas a color"
    );
  });

  it("falls back to the service name, then Pedido", () => {
    assert.equal(
      deriveOrderTitle({
        title: "",
        description: "",
        serviceName: "Encuadernación",
      }),
      "Encuadernación"
    );
    assert.equal(deriveOrderTitle({ title: "", description: "" }), "Pedido");
  });
});

describe("userFacingCreateOrderError", () => {
  it("maps API errors to short Spanish copy", () => {
    assert.equal(
      userFacingCreateOrderError("title is required"),
      "El nombre del pedido es obligatorio"
    );
    assert.equal(
      userFacingCreateOrderError("Invalid due_at"),
      "La fecha prevista no es válida"
    );
    assert.equal(
      userFacingCreateOrderError("Could not create order"),
      "No se pudo crear el pedido"
    );
  });

  it("keeps an already readable message", () => {
    assert.equal(
      userFacingCreateOrderError("La fecha prevista no es válida"),
      "La fecha prevista no es válida"
    );
  });
});
