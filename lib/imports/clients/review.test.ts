import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { ClientImportSummaryRow } from "./api";
import { buildImportReportCsv } from "./report";
import {
  CLIENT_IMPORT_ROW_DECISIONS,
  CLIENT_IMPORT_ROW_FILTERS,
  isRowDecision,
  isRowFilter,
  planLeftOut,
  rowActions,
  rowOutcome,
  rowSituation,
  type ClientImportPlan,
} from "./review";

type Row = Pick<ClientImportSummaryRow, "classification" | "decision" | "excluded">;

const migration = readFileSync(
  path.join(import.meta.dirname, "../../../supabase/migrations/20261016125500_clients_import_v1_review.sql"),
  "utf8",
);

/** Every combination the database can hold, finalize defaults and user changes included. */
const ROWS: Row[] = [
  { classification: "valid", decision: "create", excluded: false },
  { classification: "valid", decision: "create", excluded: true },
  { classification: "possible_duplicate", decision: "skip", excluded: false },
  { classification: "possible_duplicate", decision: "create", excluded: false },
  { classification: "possible_duplicate", decision: "create", excluded: true },
  { classification: "duplicate_existing", decision: "skip", excluded: false },
  { classification: "duplicate_existing", decision: "fill_blanks", excluded: false },
  { classification: "duplicate_existing", decision: "fill_blanks", excluded: true },
  { classification: "duplicate_in_file", decision: "skip", excluded: false },
  { classification: "error", decision: "skip", excluded: false },
  { classification: null, decision: null, excluded: false },
];

/** batch_plan of 20261016125500, written again from its SQL rules. */
function plan(rows: Row[]): ClientImportPlan {
  const out: ClientImportPlan = {
    create: 0, create_possible: 0, fill_blanks: 0, skip: 0, skip_existing: 0, skip_possible: 0,
    excluded: 0, error: 0, duplicate_in_file: 0, unclassified: 0, total: rows.length,
  };
  for (const row of rows) {
    const outcome = row.excluded
      ? "excluded"
      : row.decision === "create" || row.decision === "fill_blanks"
        ? row.decision
        : row.classification === null
          ? "unclassified"
          : row.classification === "error" || row.classification === "duplicate_in_file"
            ? row.classification
            : "skip";
    out[outcome] += 1;
    if (outcome === "create" && row.classification === "possible_duplicate") out.create_possible += 1;
    if (outcome === "skip" && row.classification === "duplicate_existing") out.skip_existing += 1;
    if (outcome === "skip" && row.classification === "possible_duplicate") out.skip_possible += 1;
  }
  return out;
}

describe("client import · review", () => {
  it("filters and decisions are the ones the migration accepts", () => {
    for (const filter of CLIENT_IMPORT_ROW_FILTERS) assert.ok(migration.includes(`'${filter}'`), filter);
    assert.match(migration, /not in \('create', 'skip', 'fill_blanks', 'exclude', 'include'\)/);
    assert.deepEqual([...CLIENT_IMPORT_ROW_DECISIONS], ["create", "skip", "fill_blanks", "exclude", "include"]);
    assert.ok(isRowFilter("attention") && !isRowFilter("bogus") && !isRowFilter(1));
    assert.ok(isRowDecision("exclude") && !isRowDecision("delete") && !isRowDecision(null));
  });

  it("each row shows the outcome the plan counts it in", () => {
    const p = plan(ROWS);
    const byOutcome = (outcome: string) => ROWS.filter((row) => rowOutcome(row) === outcome).length;
    assert.equal(byOutcome("create"), p.create);
    assert.equal(byOutcome("fill_blanks"), p.fill_blanks);
    assert.equal(byOutcome("skip"), p.skip);
    assert.equal(byOutcome("excluded"), p.excluded);
    assert.equal(byOutcome("not_importable"), p.error + p.duplicate_in_file);
    assert.equal(byOutcome("pending"), p.unclassified);
    assert.equal(p.create + p.fill_blanks + planLeftOut(p), p.total);
    assert.deepEqual(p, {
      create: 2, create_possible: 1, fill_blanks: 1, skip: 2, skip_existing: 1, skip_possible: 1,
      excluded: 3, error: 1, duplicate_in_file: 1, unclassified: 1, total: 11,
    });
  });

  it("offers only the changes the server allows", () => {
    const actions = (row: Row) => rowActions(row).map((action) => action.decision);
    assert.deepEqual(actions({ classification: "valid", decision: "create", excluded: false }), ["exclude"]);
    assert.deepEqual(actions({ classification: "valid", decision: "create", excluded: true }), ["include"]);
    assert.deepEqual(actions({ classification: "possible_duplicate", decision: "skip", excluded: false }), ["create", "exclude"]);
    assert.deepEqual(actions({ classification: "possible_duplicate", decision: "create", excluded: false }), ["skip", "exclude"]);
    assert.deepEqual(actions({ classification: "duplicate_existing", decision: "skip", excluded: false }), ["exclude"]);
    assert.deepEqual(actions({ classification: "duplicate_existing", decision: "fill_blanks", excluded: true }), ["include"]);
    assert.deepEqual(actions({ classification: "duplicate_in_file", decision: "skip", excluded: false }), []);
    assert.deepEqual(actions({ classification: "error", decision: "skip", excluded: false }), []);
    assert.deepEqual(actions({ classification: null, decision: null, excluded: false }), []);
  });

  it("the report tells excluded rows apart from skipped duplicates", () => {
    const row = { row_number: 2, source_record_id: null, name: "Ana", classification: "duplicate_existing", decision: "fill_blanks",
      result: "skipped", errors: [], warnings: [], client_id: null, revert_result: null };
    const lines = buildImportReportCsv([
      { ...row, result_reason: "excluded_by_user" },
      { ...row, row_number: 3, decision: "skip", result_reason: "duplicate_existing" },
    ]).split("\r\n");
    assert.equal(lines[1], "2;;Ana;Ya existe en Gestcopy;Completar campos vacíos;Omitido;Excluida en la revisión;;;;");
    assert.equal(lines[2], "3;;Ana;Ya existe en Gestcopy;Omitir;Omitido;Ya existe en Gestcopy;;;;");
    assert.match(migration, /'excluded_by_user'/);
  });

  it("explains why each row is where it is", () => {
    const base = { errors: [], warnings: [], match_reasons: [], matched_row_number: null, matched_client: null };
    const client = { id: "c", name: "Ana López", active: false, phone: "+34 600 111 222" };
    assert.equal(rowSituation({ ...base, classification: "valid", warnings: ["customer_type_not_found"] }),
      "Nueva · Tipo de cliente no encontrado (se omite)");
    assert.equal(rowSituation({ ...base, classification: "error", errors: ["name_required", "invalid_email"] }),
      "Falta el nombre, Email no válido");
    assert.equal(rowSituation({ ...base, classification: "duplicate_in_file", matched_row_number: 3, match_reasons: ["email"] }),
      "Repite la fila 3 (mismo email)");
    assert.equal(rowSituation({ ...base, classification: "duplicate_existing", matched_client: client, match_reasons: ["email", "tax_id"] }),
      "Ya existe: «Ana López» (inactivo) (mismo email, NIF/CIF)");
    assert.equal(rowSituation({ ...base, classification: "possible_duplicate", matched_client: { ...client, active: true }, match_reasons: ["phone_prefix"] }),
      "Posible duplicado de «Ana López», +34 600 111 222 (mismo teléfono sin prefijo +34)");
  });
});
