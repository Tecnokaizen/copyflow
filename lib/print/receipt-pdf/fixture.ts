// Test/evidence only. Never imported by production code.
// SUR4 E4: an order row that also carries every field the receipt must never
// print, with the witness texts of contract §10.
import { collectionAmounts } from "@/lib/print/work-sheet-rules";

export const ALL_WITNESSES = [
  "TESTIGO-NOTAS-PEDIDO",
  "TESTIGO-NOTAS-CLIENTE",
  "TESTIGO-POSTIT-INTERNO",
  "TESTIGO-POSTIT-ANULADO",
  "TESTIGO-POSTIT-SUPRIMIDO",
  "TESTIGO-DRIVE",
  "TESTIGO-COBRO",
  "TESTIGO-IMPRIMIBLE",
];

/** A row that also carries every field the receipt must never print. */
export function witnessOrder() {
  return {
    reference: "S4C-0020",
    title: "Encuadernaciones Magerit",
    description: "<p>Tapa dura, 25 ejemplares.</p><p>Estampación en <strong>dorado</strong>.</p>",
    notes: "TESTIGO-NOTAS-PEDIDO",
    external_folder_url: "https://drive.google.com/TESTIGO-DRIVE",
    priority: "urgent",
    received_at: "2026-10-15T08:30:00.000Z",
    due_at: "2026-10-30T16:00:00.000Z",
    client: {
      name: "Cliente Uno",
      company_name: "Empresa Uno",
      email: "uno@example.test",
      phone: "600 000 001",
      notes: "TESTIGO-NOTAS-CLIENTE",
      tax_id: "B00000000",
    },
    service: { name: "Encuadernación" },
    store: { name: "Tienda Centro" },
    status: { name: "Estado privado" },
    assigned_team_member: { name: "Persona privada" },
    file_status: { name: "Estado de archivos privado" },
    order_notes: [
      { body: "TESTIGO-POSTIT-INTERNO" },
      { body: "TESTIGO-POSTIT-ANULADO" },
      { body: "TESTIGO-POSTIT-SUPRIMIDO" },
      { body: "TESTIGO-IMPRIMIBLE", visibility: "printable" },
    ],
    files: [{ original_name: "archivo-privado.pdf" }],
  };
}

export const witnessCollection = {
  ok: true,
  total_amount: "1250.00",
  paid_amount: "250.00",
  pending_amount: "1000.00",
  payments: [{ id: "p", payment_method: "TESTIGO-COBRO", void_reason: "TESTIGO-COBRO", receipt: { original_name: "TESTIGO-COBRO.pdf" } }],
};

export const baseInput = {
  customLabels: false,
  amounts: collectionAmounts(witnessCollection),
  businessName: "Taller Norte",
  brandColor: "#0f3d2e",
  footer: "<p>Taller Norte · Calle Mayor 1 · 910 000 000</p>",
  timeZone: "Europe/Madrid",
  printedAt: new Date("2026-10-28T10:00:00.000Z"),
};

export const PRIVATE = ["Estado privado", "Persona privada", "Estado de archivos privado", "archivo-privado.pdf", "B00000000", "Urgente", "urgent"];
