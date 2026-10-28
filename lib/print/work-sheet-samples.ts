// Test/evidence only. Never imported by production code.
//
// SUR4 E2 (contract §10, N14): fixture orders that reproduce the layout of the
// real ficha sur4-0134 «Encuadernaciones Magerit», and a pure helper that
// renders a work sheet as a standalone HTML page (print.css inlined) to print
// the A4 samples to PDF from a browser. All personal data here is invented.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkSheetDocument } from "@/components/print/order-print-document";
import type { OrderFeatures } from "@/lib/orders/order-features";
import { printBranding, workSheetModel, type WorkSheetInput, type WorkSheetSource } from "@/lib/print/order-document";
import type { WorkSheetModel } from "@/lib/print/types";
import type { WorkSheetNoteRow, WorkSheetStepRow } from "@/lib/print/work-sheet-rules";

export const SUR4_SAMPLE_FEATURES: OrderFeatures = {
  customLabels: true,
  stickyNotes: true,
  workSequence: true,
  workSheetFicha: true,
};

export const SUR4_0134_ORDER: WorkSheetSource = {
  reference: "S4C-0134",
  title: "Encuadernaciones Magerit",
  description:
    "<p>Encuadernación en tapa dura de 25 ejemplares, 120 páginas cada uno.</p>" +
    "<p>Papel interior 100 g, cubierta en tela azul con estampación en dorado.</p>" +
    '<p><span data-text-size="large" data-text-color="red">NO CORTAR</span> el margen interior.</p>',
  priority: "high",
  received_at: "2026-10-15T08:30:00.000Z",
  due_at: "2026-10-30T16:00:00.000Z",
  client: {
    name: "Cliente de muestra",
    company_name: "Encuadernaciones Magerit (muestra)",
    contact_name: "Persona de contacto",
    phone: "600 000 000",
    email: "muestra@example.test",
  },
  service: { name: "Encuadernación" },
  store: { name: "Tienda Centro" },
  assigned_team_member: { name: "Responsable de muestra" },
  file_status: { name: "Recibido" },
  quote_status: { name: "Aceptado" },
};

export const SUR4_SAMPLE_STEPS: WorkSheetStepRow[] = [
  {
    position: 1,
    completed_at: "2026-10-16T09:00:00.000Z",
    is_current: false,
    stage: { name: "Impresión", icon: "print" },
    team_member: { name: "Persona A" },
    executed_by: { name: "Persona A" },
  },
  {
    position: 2,
    completed_at: null,
    is_current: true,
    stage: { name: "Encuadernación", icon: "bind" },
    team_member: { name: "Persona B" },
  },
  {
    position: 3,
    completed_at: null,
    is_current: false,
    stage: { name: "Revisión", icon: "review" },
    team_member: null,
  },
];

export const SUR4_SAMPLE_NOTES: WorkSheetNoteRow[] = [
  "Revisar el lomo antes de encolar.",
  "El cliente recoge por la tarde.",
  "Usar la tela del lote nuevo.",
  "Dorado en la portada y en el lomo.",
  "Embalar de cinco en cinco.",
].map((text) => ({ body: `<p>${text}</p>`, visibility: "printable", state: "open", redacted_at: null }));

export type WorkSheetSampleVariant = {
  name: string;
  order: WorkSheetSource;
  input: Partial<WorkSheetInput>;
};

/** The sample set for the A4 review (N14): base, steps and post-its, service outside, one store. */
export function sur4WorkSheetSamples(): WorkSheetSampleVariant[] {
  const amounts = { total: "450.00", paid: "150.00", pending: "300.00" };
  return [
    { name: "sur4-0134-base", order: SUR4_0134_ORDER, input: { amounts, activeStoreCount: 2 } },
    {
      name: "sur4-0134-pasos-y-postits",
      order: SUR4_0134_ORDER,
      input: { amounts, activeStoreCount: 2, steps: SUR4_SAMPLE_STEPS, notes: SUR4_SAMPLE_NOTES },
    },
    {
      name: "sur4-0134-servicio-fuera-y-sin-total",
      order: { ...SUR4_0134_ORDER, service: { name: "Plastificado" } },
      input: { amounts: { total: null, paid: "0.00", pending: null }, activeStoreCount: 2 },
    },
    { name: "sur4-0134-una-tienda", order: SUR4_0134_ORDER, input: { amounts, activeStoreCount: 1 } },
    {
      // Acceptance (§7): 15 lines of instructions, 3 steps and 5 post-its fit one A4.
      name: "sur4-0134-a4-completo",
      order: {
        ...SUR4_0134_ORDER,
        description: Array.from(
          { length: 15 },
          (_, index) => `<p>Línea ${index + 1}: indicación de encuadernación, papel, acabado o entrega.</p>`
        ).join(""),
      },
      input: { amounts, activeStoreCount: 2, steps: SUR4_SAMPLE_STEPS, notes: SUR4_SAMPLE_NOTES },
    },
  ];
}

export function sampleWorkSheetModel(
  variant: WorkSheetSampleVariant,
  features: OrderFeatures = SUR4_SAMPLE_FEATURES
): WorkSheetModel {
  return workSheetModel(variant.order, {
    profile: features.workSheetFicha ? "ficha" : "standard",
    features,
    branding: printBranding({ displayName: "SUR 4 Colores", logoUrl: null, brandColor: "#0f3d2e" }),
    timeZone: "Europe/Madrid",
    files: [],
    printedAt: "2026-10-28T10:00:00.000Z",
    ...variant.input,
  });
}

// Outside the app there is no Tailwind: the few rules rich text needs.
const STANDALONE_CSS = `
body { margin: 0; font-family: "Noto Sans", Arial, sans-serif; }
.print-rich ul { list-style: disc; padding-left: 20px; }
.print-rich ol { list-style: decimal; padding-left: 20px; }
.print-rich p { margin: 4px 0; }
[data-text-size="small"] { font-size: 0.875em; }
[data-text-size="large"] { font-size: 1.25em; }
[data-text-size="xlarge"] { font-size: 1.5em; }
[data-text-align="center"] { text-align: center; }
[data-text-align="right"] { text-align: right; }
[data-text-align="justify"] { text-align: justify; }
[data-text-color="red"] { color: hsl(var(--gc-text-red)); }
[data-text-color="orange"] { color: hsl(var(--gc-text-orange)); }
[data-text-color="green"] { color: hsl(var(--gc-text-green)); }
[data-text-color="blue"] { color: hsl(var(--gc-text-blue)); }
[data-text-color="purple"] { color: hsl(var(--gc-text-purple)); }
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

/** A standalone A4 page of the work sheet, ready to print to PDF. */
export function renderWorkSheetHtml(
  model: WorkSheetModel,
  options: { legacyNotes?: boolean; css?: string } = {}
): string {
  const css = options.css ?? readFileSync(join(process.cwd(), "components/print/print.css"), "utf8");
  const body = renderToStaticMarkup(
    createElement(WorkSheetDocument, { model, legacyNotes: options.legacyNotes ?? false })
  );
  return [
    "<!doctype html>",
    '<html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(model.documentTitle)}</title>`,
    `<style>${STANDALONE_CSS}\n${css}</style>`,
    `</head><body>${body}</body></html>`,
  ].join("");
}
