/**
 * Synthetic client-import fixtures for Migration V1 QA
 * (docs/adr/2026-10-16-clients-import-v1.md, PR 1).
 *
 * Deterministic for a given seed. Every value is fictitious: emails use the
 * reserved example.* domains and NIF numbers sit above the issued DNI range.
 * Never commit or generate fixtures from real exports.
 *
 * CLI:
 *   npx tsx scripts/imports/client-fixtures.ts --rows 1000 --seed 42 \
 *     --delimiter ";" --encoding windows-1252 --out /tmp/clients.csv
 * writes the CSV and `<out>.manifest.json` with the expected classification.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type FixtureDelimiter = ";" | "," | "\t";
export type FixtureEncoding = "utf8" | "utf8-bom" | "windows-1252";
export type FixtureHeader = "es" | "en";

export type RowKind =
  | "valid"
  | "missing_name"
  | "invalid_email"
  | "in_file_duplicate"
  | "phone_prefix_duplicate";

export type FixtureOptions = {
  rows: number;
  seed: number;
  delimiter?: FixtureDelimiter;
  encoding?: FixtureEncoding;
  header?: FixtureHeader;
};

export type FixtureManifest = {
  rows: number;
  seed: number;
  delimiter: FixtureDelimiter;
  encoding: FixtureEncoding;
  columns: string[];
  counts: Record<RowKind, number> & { formula_cells: number; multiline_notes: number };
  /** 1-based data row number (header excluded) → expected classification. */
  kinds: RowKind[];
};

const COLUMNS: Record<FixtureHeader, string[]> = {
  es: ["Código", "Nombre", "Empresa", "Contacto", "NIF", "Email", "Teléfono", "Dirección", "CP", "Población", "Provincia", "Notas", "Tipo de cliente"],
  en: ["Code", "Name", "Company", "Contact", "Tax ID", "Email", "Phone", "Address", "Postal code", "City", "Province", "Notes", "Customer type"],
};

const FIRST_NAMES = ["Lucía", "Íñigo", "Begoña", "José María", "Ramón", "Núria", "Agustín", "Pilar", "Ángela", "Joaquín"];
const SURNAMES = ["Pérez", "Muñoz", "Gómez", "Ibáñez", "Castaño", "Peña", "Ortúzar", "Güell", "Martínez", "Sáenz"];
const CITIES: [string, string, string][] = [
  ["Málaga", "Málaga", "29001"],
  ["A Coruña", "A Coruña", "15001"],
  ["Logroño", "La Rioja", "26001"],
  ["Cádiz", "Cádiz", "11001"],
  ["L'Hospitalet de Llobregat", "Barcelona", "08901"],
  ["Alcalá de Henares", "Madrid", "28801"],
];
const STREETS = ["C/ Mayor", "Avda. de la Constitución", "Pza. España", "C/ San Andrés", "Ronda Nueva"];
const CUSTOMER_TYPES = ["Particular", "Empresa", "Estudiante", "Administración", ""];
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const EMAIL_DOMAINS = ["example.com", "example.org", "example.net"];

/** mulberry32: small deterministic PRNG, enough for fixtures. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kindFor(index: number): RowKind {
  if (index % 25 === 12) return "missing_name";
  if (index % 25 === 18) return "invalid_email";
  if (index >= 10 && index % 10 === 9) return "in_file_duplicate";
  if (index >= 10 && index % 20 === 7) return "phone_prefix_duplicate";
  return "valid";
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

function formatPhone(digits: string, style: number) {
  if (style === 0) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  if (style === 1) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 7)}-${digits.slice(7)}`;
}

function csvField(value: string, delimiter: FixtureDelimiter) {
  const needsQuotes = value.includes(delimiter) || /["\r\n]/.test(value) || value !== value.trim();
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Windows-1252 for the Latin-1 range plus €; anything else is a fixture bug. */
function encodeWindows1252(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes[i] = code;
    else if (code === 0x20ac) bytes[i] = 0x80;
    else throw new Error(`Character U+${code.toString(16)} is not in the Windows-1252 fixture set`);
  }
  return bytes;
}

export function encodeFixture(text: string, encoding: FixtureEncoding): Uint8Array {
  if (encoding === "windows-1252") return encodeWindows1252(text);
  const utf8 = new TextEncoder().encode(text);
  if (encoding === "utf8") return utf8;
  const withBom = new Uint8Array(utf8.length + 3);
  withBom.set([0xef, 0xbb, 0xbf]);
  withBom.set(utf8, 3);
  return withBom;
}

export function generateClientFixture(options: FixtureOptions): { text: string; bytes: Uint8Array; manifest: FixtureManifest } {
  const { rows, seed } = options;
  const delimiter = options.delimiter ?? ";";
  const encoding = options.encoding ?? "utf8";
  const columns = COLUMNS[options.header ?? "es"];
  if (!Number.isInteger(rows) || rows < 1 || rows > 100_000) throw new Error("rows must be an integer between 1 and 100000");

  const random = prng(seed);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  const records: string[][] = [];
  const kinds: RowKind[] = [];
  let formulaCells = 0;
  let multilineNotes = 0;

  for (let index = 0; index < rows; index += 1) {
    const kind = kindFor(index);
    const first = pick(FIRST_NAMES);
    const surname = pick(SURNAMES);
    const [city, province, postalCode] = pick(CITIES);
    const isCompany = random() < 0.4;
    const dni = 99_000_000 + Math.floor(random() * 999_999);
    const phoneDigits = `6${String(Math.floor(random() * 1e8)).padStart(8, "0")}`;

    let name = isCompany ? `Imprenta ${surname}` : `${first} ${surname}`;
    let email = `${slug(first)}.${slug(surname)}.${index + 1}@${pick(EMAIL_DOMAINS)}`;
    let phone = formatPhone(phoneDigits, index % 3);
    let notes = "";

    if (index % 15 === 4) {
      notes = `=HYPERLINK("https://example.com/${index + 1}";"ver")`;
      formulaCells += 1;
    } else if (index % 12 === 5) {
      notes = `Presupuesto máx. 50 €\nRecoge en tienda; pagar "al contado"`;
      multilineNotes += 1;
    }

    if (kind === "missing_name") name = "";
    if (kind === "invalid_email") email = `no-es-un-email-${index + 1}`;
    if (kind === "in_file_duplicate") email = `  ${records[index - 9][5].toUpperCase()} `;
    if (kind === "phone_prefix_duplicate") phone = `+34 ${records[index - 1][6].replace(/\D/g, "").slice(-9)}`;

    records.push([
      `GC-${String(index + 1).padStart(6, "0")}`,
      name,
      isCompany ? `Imprenta ${surname} S.L.` : "",
      isCompany ? `${first} ${surname}` : "",
      isCompany ? `B${dni}` : `${dni}${DNI_LETTERS[dni % 23]}`,
      email,
      phone,
      `${pick(STREETS)}, ${1 + Math.floor(random() * 120)}`,
      postalCode,
      city,
      province,
      notes,
      pick(CUSTOMER_TYPES),
    ]);
    kinds.push(kind);
  }

  const lines = [columns, ...records].map((record) => record.map((value) => csvField(value, delimiter)).join(delimiter));
  const text = `${lines.join("\r\n")}\r\n`;
  const counts = {
    valid: 0,
    missing_name: 0,
    invalid_email: 0,
    in_file_duplicate: 0,
    phone_prefix_duplicate: 0,
    formula_cells: formulaCells,
    multiline_notes: multilineNotes,
  };
  for (const kind of kinds) counts[kind] += 1;

  return {
    text,
    bytes: encodeFixture(text, encoding),
    manifest: { rows, seed, delimiter, encoding, columns, counts, kinds },
  };
}

function readFlag(args: string[], name: string) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(args: string[]) {
  const out = readFlag(args, "out");
  if (!out) throw new Error("--out is required");
  const delimiterFlag = readFlag(args, "delimiter") ?? ";";
  const delimiter = (delimiterFlag === "tab" || delimiterFlag === "\\t" ? "\t" : delimiterFlag) as FixtureDelimiter;
  if (![";", ",", "\t"].includes(delimiter)) throw new Error("--delimiter must be ; , or tab");
  const { bytes, manifest } = generateClientFixture({
    rows: Number(readFlag(args, "rows") ?? 100),
    seed: Number(readFlag(args, "seed") ?? 1),
    delimiter,
    encoding: (readFlag(args, "encoding") ?? "utf8") as FixtureEncoding,
    header: (readFlag(args, "header") ?? "es") as FixtureHeader,
  });
  writeFileSync(out, bytes);
  writeFileSync(`${out}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${manifest.rows} rows → ${out}`, manifest.counts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
