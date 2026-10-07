import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { ASSIGNMENT_LOCK_MESSAGE, QuoteAssigneeControl, QuoteClientService } from "./quote-assignment";
import type { QuoteRecord } from "@/lib/quotes/types";

const quote = {
  client: { id: "client-1", name: "Cliente X" },
  service: { id: "service-1", name: "Impresión" },
  assignee: null,
} as QuoteRecord;

describe("quote assignment layout", () => {
  it("places client and service in the quote data card and the assignee in the header", () => {
    const editor = readFileSync(new URL("./quote-commercial-editor.tsx", import.meta.url), "utf8");
    const form = readFileSync(new URL("./quote-draft-form.tsx", import.meta.url), "utf8");
    assert.equal(editor.includes("Gestión operativa"), false);
    assert.equal(editor.includes("QuoteOperationalForm"), false);
    assert.match(editor, /clientSlot=\{assignment\}/);
    assert.match(editor, /QuoteAssigneeControl/);
    assert.match(editor, /client-draft/);
    assert.match(editor, /operational_only: true/);
    assert.match(editor, /expected_row_version: detail\.quote\.row_version/);
    assert.match(editor, /autofillClient\(values\.header, client, edited\.current\)/);
    assert.match(editor, /client_manual_fields: \[\.\.\.edited\.current\]/);
    assert.match(editor, /ASSIGNMENT_LOCK_MESSAGE/);
    assert.match(form, /clientSlot \?\?/);
    assert.equal(form.includes("Gestión operativa"), false);
  });

  it("renders client and service without a separate operational card", () => {
    const html = renderToStaticMarkup(createElement(QuoteClientService, {
      quote,
      busy: false,
      assignmentLocked: true,
      clientLocked: false,
      onClientChange: () => {},
      onServiceChange: () => {},
    }));
    assert.match(html, /Cliente asociado/);
    assert.match(html, /Cliente X/);
    assert.match(html, /Servicio/);
    assert.match(html, /Impresión/);
    assert.match(html, new RegExp(ASSIGNMENT_LOCK_MESSAGE));
    assert.equal(html.includes("Gestión operativa"), false);
    assert.equal(html.includes("gc-section-title"), false);
  });

  it("renders the assignee as a compact header action", () => {
    const html = renderToStaticMarkup(createElement(QuoteAssigneeControl, {
      assignee: null,
      busy: false,
      locked: true,
      onSave: () => {},
    }));
    assert.match(html, /Responsable: Sin asignar/);
    assert.match(html, /Cambiar responsable/);
    assert.match(html, /disabled/);
    assert.equal(html.includes("Gestión operativa"), false);
  });
});
