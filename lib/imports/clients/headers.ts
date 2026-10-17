/** Fields a column can be mapped to. Address parts are joined into one address. */
export const CLIENT_IMPORT_FIELDS = [
  "name",
  "company_name",
  "contact_name",
  "tax_id",
  "email",
  "phone",
  "address",
  "postal_code",
  "city",
  "province",
  "notes",
  "customer_type",
  "source_record_id",
] as const;

export type ClientImportField = (typeof CLIENT_IMPORT_FIELDS)[number];

export const CLIENT_IMPORT_FIELD_LABELS: Record<ClientImportField, string> = {
  name: "Nombre",
  company_name: "Empresa",
  contact_name: "Persona de contacto",
  tax_id: "NIF/CIF",
  email: "Email",
  phone: "Teléfono",
  address: "Dirección",
  postal_code: "Código postal",
  city: "Población",
  province: "Provincia",
  notes: "Notas",
  customer_type: "Tipo de cliente",
  source_record_id: "Código en el programa anterior",
};

/** Header synonyms (Spanish and English), already in normalizeHeader form. */
const SYNONYMS: Record<ClientImportField, string[]> = {
  name: [
    "nombre", "nombre cliente", "nombre del cliente", "cliente", "nombre completo", "nombre y apellidos",
    "apellidos y nombre", "denominacion", "name", "full name", "customer", "customer name", "client", "client name",
  ],
  company_name: [
    "empresa", "razon social", "nombre fiscal", "nombre comercial", "sociedad", "entidad", "organizacion",
    "company", "company name", "business name", "organization", "organisation",
  ],
  contact_name: [
    "contacto", "persona de contacto", "persona contacto", "nombre contacto", "atencion", "att",
    "contact", "contact name", "contact person",
  ],
  tax_id: [
    "nif", "cif", "nif cif", "cif nif", "dni", "nie", "dni nif", "nif iva", "nif intracomunitario",
    "identificacion fiscal", "documento", "vat", "vat number", "vat id", "tax id", "tax number",
  ],
  email: ["email", "e mail", "correo", "correo electronico", "mail", "email address", "e mail address"],
  phone: [
    "telefono", "tel", "tlf", "tfno", "telf", "movil", "telefono movil", "telefono fijo", "celular",
    "telefono 1", "phone", "mobile", "phone number", "telephone", "cell",
  ],
  address: ["direccion", "domicilio", "calle", "direccion postal", "address", "street", "street address", "address line 1"],
  postal_code: ["cp", "codigo postal", "cod postal", "postal code", "zip", "zip code", "postcode"],
  city: ["poblacion", "localidad", "ciudad", "municipio", "city", "town"],
  province: ["provincia", "region", "comunidad", "comunidad autonoma", "province", "state", "county"],
  notes: ["notas", "nota", "observaciones", "comentarios", "comentario", "notes", "comments", "remarks"],
  customer_type: ["tipo", "tipo cliente", "tipo de cliente", "categoria", "segmento", "customer type", "client type", "type", "category"],
  source_record_id: [
    "codigo", "codigo cliente", "cod cliente", "id", "id cliente", "referencia", "ref", "numero cliente",
    "n cliente", "num cliente", "numero de cliente", "code", "customer id", "client id", "customer code",
    "external id", "account number",
  ],
};

const SYNONYM_INDEX = new Map<string, ClientImportField>(
  CLIENT_IMPORT_FIELDS.flatMap((field) => SYNONYMS[field].map((synonym) => [synonym, field] as const)),
);

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\bn\s*[º°]\s*/g, "numero ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Suggests a field for each column. Exact synonym matches only; each field is
 * suggested for the first matching column. The user reviews every suggestion.
 */
export function suggestMapping(headers: string[]): (ClientImportField | null)[] {
  const used = new Set<ClientImportField>();
  return headers.map((header) => {
    const field = SYNONYM_INDEX.get(normalizeHeader(header)) ?? null;
    if (!field || used.has(field)) {
      return null;
    }
    used.add(field);
    return field;
  });
}
