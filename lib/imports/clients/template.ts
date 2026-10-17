import { normalizeHeader } from "./headers";

/**
 * Gestcopy client template, versioned. A version is the exact set of columns;
 * files are recognised by their headers, so templates downloaded before the
 * version existed (same columns as v1) are still recognised as v1.
 * A future version adds an entry here and keeps the older ones.
 */
export const CLIENT_IMPORT_TEMPLATES = {
  1: {
    headers: [
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
    ],
    example: [
      "C-001",
      "Ana Ejemplo",
      "",
      "",
      "12345678Z",
      "ana@example.com",
      "600 000 000",
      "Calle Mayor 1",
      "28001",
      "Madrid",
      "Madrid",
      "Cliente de ejemplo: borra esta fila",
      "Particular",
    ],
  },
} as const;

export type ClientImportTemplateVersion = keyof typeof CLIENT_IMPORT_TEMPLATES;

export const CLIENT_IMPORT_TEMPLATE_VERSION: ClientImportTemplateVersion = 1;

export const CLIENT_IMPORT_TEMPLATE_FILE_NAME = `plantilla-clientes-gestcopy-v${CLIENT_IMPORT_TEMPLATE_VERSION}.csv`;

/** Current template: semicolon CSV with BOM so Excel opens it in Spanish locale. */
export function buildClientImportTemplateCsv() {
  const { headers, example } = CLIENT_IMPORT_TEMPLATES[CLIENT_IMPORT_TEMPLATE_VERSION];
  return `﻿${headers.join(";")}\r\n${example.join(";")}\r\n`;
}

/**
 * Newest template version whose columns are all present in the file (order and
 * accents/case do not matter; extra columns are allowed). null for other files.
 */
export function detectClientImportTemplate(headers: string[]): ClientImportTemplateVersion | null {
  const present = new Set(headers.map(normalizeHeader));
  const versions = Object.keys(CLIENT_IMPORT_TEMPLATES)
    .map(Number)
    .sort((a, b) => b - a) as ClientImportTemplateVersion[];
  for (const version of versions) {
    if (CLIENT_IMPORT_TEMPLATES[version].headers.every((header) => present.has(normalizeHeader(header)))) {
      return version;
    }
  }
  return null;
}
