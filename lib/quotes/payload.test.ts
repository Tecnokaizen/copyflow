import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { interpretConvertResult } from "./errors";
import {
  parseCreateQuotePayload,
  parseQuoteStatusPayload,
  parseUpdateQuotePayload,
} from "./payload";

const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STATUS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("quote payloads", () => {
  it("accepts a create payload and ignores tenant and reference", () => {
    const parsed = parseCreateQuotePayload({
      tenant_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      reference: "SUR4-P9999",
      title: " Tarjetas ",
      description: " 500 tarjetas ",
      notes: "",
      valid_until: "2026-10-01",
      client_id: CLIENT,
      service_id: "",
      assigned_team_member_id: null,
    });

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }

    assert.equal(parsed.data.title, "Tarjetas");
    const titled = parseCreateQuotePayload({
      description: "Trabajo",
      title: "Oferta <Especial>",
    });
    assert.equal(titled.ok, true);
    if (titled.ok) {
      assert.equal(titled.data.title, "Oferta <Especial>");
    }
    assert.equal(parsed.data.description, "<p>500 tarjetas</p>");
    assert.equal(parsed.data.notes, null);
    assert.equal(parsed.data.valid_until, "2026-10-01");
    assert.equal(parsed.data.client_id, CLIENT);
    assert.equal(parsed.data.service_id, null);
    assert.equal("tenant_id" in parsed.data, false);
    assert.equal("reference" in parsed.data, false);
  });

  it("requires a description", () => {
    const parsed = parseCreateQuotePayload({ description: "   " });
    assert.equal(parsed.ok, false);
  });

  it("rejects an invalid validity date", () => {
    const parsed = parseCreateQuotePayload({
      description: "Trabajo",
      valid_until: "2026-02-31",
    });
    assert.equal(parsed.ok, false);
  });

  it("keeps valid_until as a date and rejects a datetime", () => {
    const parsed = parseCreateQuotePayload({
      description: "Trabajo",
      valid_until: "2026-09-23T10:30:00.000Z",
    });
    assert.equal(parsed.ok, false);

    const dateOnly = parseCreateQuotePayload({
      description: "Trabajo",
      valid_until: "2026-09-23",
    });
    assert.equal(dateOnly.ok, true);
    if (dateOnly.ok) {
      assert.equal(dateOnly.data.valid_until, "2026-09-23");
    }
  });

  it("requires the current row version on update", () => {
    const parsed = parseUpdateQuotePayload({
      description: "Trabajo",
      expected_row_version: 2,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.data.expected_row_version, 2);
    }

    assert.equal(
      parseUpdateQuotePayload({ description: "Trabajo" }).ok,
      false
    );
  });

  it("requires a status id that looks like a uuid", () => {
    assert.equal(
      parseQuoteStatusPayload({
        status_id: STATUS,
        expected_row_version: 0,
      }).ok,
      true
    );
    assert.equal(
      parseQuoteStatusPayload({
        status_id: "Aceptado",
        expected_row_version: 0,
      }).ok,
      false
    );
  });

  it("rejects visually empty description and strips an API XSS payload", () => {
    assert.equal(parseCreateQuotePayload({ description: "<p></p>" }).ok, false);
    assert.equal(parseCreateQuotePayload({ description: "<p><br></p>" }).ok, false);
    assert.equal(parseCreateQuotePayload({ description: "<p>&nbsp;</p>" }).ok, false);

    const parsed = parseCreateQuotePayload({
      description:
        '<p onclick="alert(1)">Hola</p><script>alert(1)</script><img src=x onerror=alert(1)>',
      notes: '<a href="javascript:alert(1)">nota</a>',
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.description, "<p>Hola</p>");
    assert.equal(parsed.data.notes?.includes("javascript:"), false);
    assert.equal(/<script|<img|onclick/i.test(parsed.data.description), false);
  });
});

describe("quote conversion result", () => {
  it("treats a second success with created false as the same order", () => {
    const first = interpretConvertResult({
      ok: true,
      created: true,
      order_id: CLIENT,
      reference: "SUR4-0020",
    });
    const second = interpretConvertResult({
      ok: true,
      created: false,
      order_id: CLIENT,
      reference: "SUR4-0020",
    });

    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) {
      return;
    }

    assert.equal(first.created, true);
    assert.equal(second.replayed, true);
    assert.equal(second.orderId, first.orderId);
  });

  it("hides a missing quote", () => {
    const result = interpretConvertResult({ ok: false, error: "not_found" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 404);
    }
  });
});

describe("quote form boundaries", () => {
  it("reuses the client form and does not import order screens", () => {
    const source = readFileSync(
      new URL("../../components/quotes/quote-form.tsx", import.meta.url),
      "utf8"
    );
    assert.match(source, /ClientSelector/);
    assert.match(source, /ClientForm/);
    assert.match(source, /ClientModal/);
    assert.equal(source.includes("components/orders/"), false);
    assert.equal(source.includes("valid_until"), false);
  });
});
