// Test/evidence only. Never imported by production code.
export function anfreFixture() {
  const version = { id: "v-fixture", quote_id: "q-fixture", version_number: 1, state: "prepared",
    title: "CONGRESO MATERIAS PRIMAS", description: "<p>Material para el congreso.</p>", terms: "<p>Validez de la oferta: 30 días. Precios en euros.</p>",
    issue_date: "2026-10-05", valid_until: "2026-11-04", currency: "EUR", prices_include_tax: true,
    subtotal: "520.66", tax_total: "109.34", total: "630.00", row_version: 7,
    created_at: "2026-10-05T10:00:00Z", locked_at: "2026-10-05T10:01:00Z", sent_at: null, pdf_file_id: null,
    tax_breakdown: [{ tax_rate: "21", subtotal: "520.66", tax_amount: "109.34", total: "630.00" }],
    seller_snapshot: { business_name: "Copistería de prueba", tax_id: "B00000000", billing_address: "Calle de prueba 1\n28000 Madrid", branding: {} },
    client_snapshot: { name: "ANFRE", billing_name: "ANFRE", contact_name: "Raquel Horcajo", billing_address: "Dirección de prueba" },
    notes: "INTERNAL_ONLY_DO_NOT_PRINT", assignee: "INTERNAL_ONLY_DO_NOT_PRINT",
  };
  const lines = [ ["Roll Up", "2", "105", "173.55", "36.45", "210"], ["Block notas A5", "60", "5.05", "250.41", "52.59", "303"],
    ["Identificadores", "60", "1.10", "54.55", "11.45", "66"], ["Cartulina", "60", "0.85", "42.15", "8.85", "51"] ];
  const items = lines.map(([concept, quantity, unit_price, subtotal, tax_amount, total], i) => ({
    id: `i${i}`, position: i + 1, concept, description: null, quantity: `${quantity}.000000`, unit: "ud", unit_price, subtotal, tax_amount, total, discount_percent: "0.000000", tax_rate: "21.000000",
  }));
  return { reference: "TEST-P0001", version, items };
}
