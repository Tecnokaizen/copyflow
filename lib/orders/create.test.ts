import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveOrderTitle,
  userFacingCreateOrderError,
} from "./create";

function hasLoneSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

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

  it("clips at 80 Unicode scalars without leaving broken surrogates", () => {
    const clipped = deriveOrderTitle({
      title: `${"a".repeat(79)}😀fin`,
    });
    assert.equal(clipped, `${"a".repeat(79)}😀`);
    assert.equal(Array.from(clipped).length, 80);
    assert.equal(hasLoneSurrogate(clipped), false);
  });

  it("replaces lone surrogates and preserves emoji at the exact limit", () => {
    const exact = `${"😀".repeat(40)}${"a".repeat(40)}`;
    assert.equal(deriveOrderTitle({ title: exact }), exact);
    assert.equal(Array.from(exact).length, 80);

    const malformed = deriveOrderTitle({
      title: `${"a".repeat(79)}\uD83Dextra`,
    });
    assert.equal(malformed, `${"a".repeat(79)}�`);
    assert.equal(Array.from(malformed).length, 80);
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
