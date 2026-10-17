import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suggestMapping } from "./headers";
import { parseImportFile } from "./parse-file";
import {
  CLIENT_IMPORT_TEMPLATE_FILE_NAME,
  CLIENT_IMPORT_TEMPLATE_VERSION,
  CLIENT_IMPORT_TEMPLATES,
  buildClientImportTemplateCsv,
  detectClientImportTemplate,
} from "./template";

const V1 = [
  "Código",
  "Nombre",
  "Empresa",
  "Persona de contacto",
  "NIF/CIF",
  "Email",
  "Teléfono",
  "Dirección",
  "Código postal",
  "Población",
  "Provincia",
  "Notas",
  "Tipo de cliente",
];

describe("client import · versioned template", () => {
  it("v1 keeps exactly the columns of the original template", () => {
    assert.deepEqual([...CLIENT_IMPORT_TEMPLATES[1].headers], V1);
    assert.equal(CLIENT_IMPORT_TEMPLATES[1].example.length, V1.length);
    assert.equal(CLIENT_IMPORT_TEMPLATE_VERSION, 1);
    assert.equal(CLIENT_IMPORT_TEMPLATE_FILE_NAME, "plantilla-clientes-gestcopy-v1.csv");
  });

  it("the downloadable template is recognised and every column is mapped", async () => {
    const bytes = new TextEncoder().encode(buildClientImportTemplateCsv());
    const parsed = await parseImportFile({ name: CLIENT_IMPORT_TEMPLATE_FILE_NAME, bytes: bytes.buffer as ArrayBuffer });
    assert.deepEqual(parsed.headers, V1);
    assert.equal(detectClientImportTemplate(parsed.headers), 1);
    const mapping = suggestMapping(parsed.headers);
    assert.ok(mapping.every(Boolean), `unmapped: ${parsed.headers.filter((_, i) => !mapping[i]).join(", ")}`);
    assert.equal(new Set(mapping).size, mapping.length);
  });

  it("recognises templates saved before versioning, reordered or re-cased", () => {
    assert.equal(detectClientImportTemplate([...V1].reverse()), 1);
    assert.equal(detectClientImportTemplate(V1.map((header) => header.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, ""))), 1);
    assert.equal(detectClientImportTemplate([...V1, "Columna añadida"]), 1);
  });

  it("does not take other files for the template", () => {
    assert.equal(detectClientImportTemplate(V1.slice(1)), null);
    assert.equal(detectClientImportTemplate(["Nombre", "Email", "Teléfono"]), null);
  });
});
