import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeHeader, suggestMapping } from "./headers";
import { mapRows, mappingToRecord, validateMapping, type ClientImportMapping } from "./mapping";
import { normalizeEmail, normalizePhone, normalizeTaxId, phoneCore, previewRowProblems } from "./normalize";
import { buildImportReportCsv, neutralizeCell } from "./report";

describe("client import · header suggestions", () => {
  it("normalizes accents, punctuation and Nº", () => {
    assert.equal(normalizeHeader("  Teléfono Móvil "), "telefono movil");
    assert.equal(normalizeHeader("N.I.F./C.I.F."), "nif cif");
    assert.equal(normalizeHeader("Nombre"), "nombre");
    assert.equal(normalizeHeader("C.P."), "cp");
    assert.equal(normalizeHeader("Nº Cliente"), "numero cliente");
    assert.equal(normalizeHeader("E-mail"), "e mail");
  });

  it("maps Spanish and English exports from other programs", () => {
    assert.deepEqual(
      suggestMapping(["Código", "Razón social", "NIF", "Persona de contacto", "Correo electrónico", "Tlf", "Domicilio", "C.P.", "Población", "Provincia", "Observaciones", "Tipo de cliente", "Fecha alta"]),
      ["source_record_id", "company_name", "tax_id", "contact_name", "email", "phone", "address", "postal_code", "city", "province", "notes", "customer_type", null],
    );
    assert.deepEqual(
      suggestMapping(["Customer ID", "Name", "Company", "VAT number", "Email", "Phone", "Street address", "Zip", "City", "State", "Notes"]),
      ["source_record_id", "name", "company_name", "tax_id", "email", "phone", "address", "postal_code", "city", "province", "notes"],
    );
  });

  it("suggests each field once (first matching column wins)", () => {
    assert.deepEqual(suggestMapping(["Teléfono", "Móvil", "Email", "Correo"]), ["phone", null, "email", null]);
  });
});

describe("client import · mapping", () => {
  const headers = ["Código", "Nombre", "Empresa", "Email", "Teléfono", "Calle", "CP", "Ciudad", "Provincia", "Notas"];
  const mapping = suggestMapping(headers);

  it("validates that a name or company is mapped and fields are unique", () => {
    assert.deepEqual(validateMapping(mapping), []);
    assert.deepEqual(validateMapping([null, "email"]), ["name_or_company_required"]);
    assert.deepEqual(validateMapping(["company_name", "phone", "phone"]), ["duplicate_field:phone"]);
  });

  it("joins address parts and uses the company when the name is empty", () => {
    const [row] = mapRows([["7", "", "Imprenta Sur SL", "info@example.com", "600 111 222", "C/ Mayor, 1", "29001", "Málaga", "Málaga", ""]], mapping);
    assert.deepEqual(row, {
      row_number: 1,
      name: "Imprenta Sur SL",
      company_name: "Imprenta Sur SL",
      contact_name: null,
      tax_id: null,
      email: "info@example.com",
      phone: "600 111 222",
      address: "C/ Mayor, 1, 29001 Málaga",
      notes: null,
      customer_type: null,
      source_record_id: "7",
    });
  });

  it("keeps the first phone and email and moves the rest to the notes", () => {
    const [row] = mapRows(
      [["1", "Ana", "", "Ana <ana@example.com>; ana2@example.org", "600111222 / 911223344", "", "", "", "", "Cliente antiguo"]],
      mapping,
    );
    assert.equal(row.email, "ana@example.com");
    assert.equal(row.phone, "600111222");
    assert.equal(row.notes, "Cliente antiguo\nOtros teléfonos: 911223344\nOtros emails: ana2@example.org");
  });

  it("skips empty rows but keeps the numbering of the file", () => {
    const rows = mapRows([["1", "Ana"], ["", "  "], ["3", "Luis"]], mapping);
    assert.deepEqual(rows.map((row) => [row.row_number, row.name]), [[1, "Ana"], [3, "Luis"]]);
  });

  it("collapses inner spaces and non-breaking spaces", () => {
    const [row] = mapRows([["1", "  Ana   María   Pérez "]], mapping);
    assert.equal(row.name, "Ana María Pérez");
  });

  it("stores the mapping by column position and header", () => {
    const map: ClientImportMapping = ["source_record_id", "name", null];
    assert.deepEqual(mappingToRecord(["Código", "Nombre", "Fecha"], map), { "0:Código": "source_record_id", "1:Nombre": "name" });
  });
});

describe("client import · preview normalization (mirrors the database)", () => {
  it("normalizes like normalize_client_* and phone_core", () => {
    assert.equal(normalizeEmail("  Ana@Example.COM "), "ana@example.com");
    assert.equal(normalizePhone("+34 (600) 11-22-33"), "34600112233");
    assert.equal(normalizeTaxId(" b-1234.5678 "), "B12345678");
    assert.equal(phoneCore("34600112233"), "600112233");
    assert.equal(phoneCore("0034600112233"), "600112233");
    assert.equal(phoneCore("600112233"), "600112233");
    assert.equal(phoneCore("3460011"), "3460011");
  });

  it("flags the same problems the server rejects", () => {
    const base = { row_number: 1, name: "Ana", company_name: null, contact_name: null, tax_id: null, email: null, phone: null, address: null, notes: null, customer_type: null, source_record_id: null };
    assert.deepEqual(previewRowProblems(base), []);
    assert.deepEqual(previewRowProblems({ ...base, name: " " }), ["name_required"]);
    assert.deepEqual(previewRowProblems({ ...base, email: "no-es-email" }), ["invalid_email"]);
    assert.deepEqual(previewRowProblems({ ...base, phone: "12" }), ["invalid_phone"]);
    assert.deepEqual(previewRowProblems({ ...base, tax_id: "A1" }), ["invalid_tax_id"]);
    assert.deepEqual(previewRowProblems({ ...base, address: "x".repeat(501) }), ["too_long:address"]);
  });
});

describe("client import · report", () => {
  it("neutralizes formula-like cells", () => {
    for (const value of ["=1+1", "+34600", "-5", "@SUM(A1)", "\tx", "\rx"]) {
      assert.equal(neutralizeCell(value), `'${value}`);
    }
    assert.equal(neutralizeCell("Ana"), "Ana");
  });

  it("builds an Excel-friendly CSV with Spanish labels", () => {
    const csv = buildImportReportCsv([
      { row_number: 3, source_record_id: "=HYPERLINK(\"x\")", name: "Ana; López", classification: "duplicate_existing", decision: "skip",
        result: "skipped", result_reason: "duplicate_existing", errors: [], warnings: ["customer_type_not_found"], client_id: null, revert_result: null },
      { row_number: 4, source_record_id: null, name: "Luis", classification: "valid", decision: "create",
        result: "created", result_reason: null, errors: [], warnings: [], client_id: "c-1", revert_result: "deactivated" },
    ]);
    assert.ok(csv.startsWith("﻿Fila;Código de origen;Nombre;"));
    const lines = csv.split("\r\n");
    assert.equal(lines[1], `3;"'=HYPERLINK(""x"")";"Ana; López";Ya existe en Gestcopy;Omitir;Omitido;Ya existe en Gestcopy;;Tipo de cliente no encontrado (se omite);;`);
    assert.equal(lines[2], "4;;Luis;Válida;Crear;Creado;;;;c-1;Desactivado");
  });
});
