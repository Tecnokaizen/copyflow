import type { WorkStageIcon } from "@/lib/orders/work-stage-icons";

export type PrintFact = {
  label: string;
  value: string;
};

export type PrintBranding = {
  displayName: string;
  logoUrl: string | null;
  brandColor: string | null;
};

// SUR4 E2 (contract §6, N25): one work sheet, two closed profiles. The profile
// only decides which blocks are printed and in which order.
export type WorkSheetProfile = "standard" | "ficha";

/** One step of the work sequence, printed with a checkbox (E7). */
export type WorkSheetStep = {
  position: number;
  stageName: string;
  stageIcon: WorkStageIcon;
  /** Assigned person, or «Sin asignar». */
  personName: string;
  /** Who did it, only when it differs from the assigned person. */
  executorName: string | null;
  done: boolean;
  current: boolean;
};

/** A post-it expressly authorized as printable (sanitized rich text). */
export type WorkSheetNote = {
  body: string;
};

/** Blocks that only the ficha profile prints (N19, N20, sur4-0134). */
export type WorkSheetFicha = {
  /** Store next to the reference, only with more than one active store. */
  store: string | null;
  /** The three amounts, named by orderLabels. */
  amounts: PrintFact[];
  dueAt: PrintFact;
  /** Blank fields to fill in by hand (N10). */
  proofFields: string[];
  /** Service on the first line of the description box, when not already in it. */
  service: string | null;
  assignee: PrintFact;
  /** Priority, reception, file status and quote status; never the order status. */
  bottom: PrintFact[];
  /** «Documento interno» footer. */
  footer: string;
  printedAt: string;
};

/**
 * The work sheet. It has no field for orders.notes, clients.notes,
 * external_folder_url or the payment detail: the loader never reads them.
 * The standard profile fills the same blocks as the print of today
 * (client … files); the ficha profile fills `ficha` and leaves the
 * standard-only blocks empty.
 */
export type WorkSheetModel = {
  profile: WorkSheetProfile;
  documentTitle: string;
  kind: "Pedido" | "Hoja de trabajo";
  reference: string;
  title: string;
  branding: PrintBranding;
  client: PrintFact[];
  order: PrintFact[];
  dates: PrintFact[];
  description: string | null;
  descriptionTitle: string;
  production: PrintFact[];
  payment: PrintFact[];
  files: string[];
  fileCountLabel: string;
  steps: WorkSheetStep[];
  printableNotes: WorkSheetNote[];
  ficha: WorkSheetFicha | null;
};

/**
 * SUR4 E4: the customer receipt («Resguardo»). Closed list: no notes,
 * post-its, staff, status, priority, files or payment detail.
 */
export type CustomerReceiptModel = {
  documentTitle: string;
  filename: string;
  reference: string;
  title: string;
  businessName: string;
  brandColor: string;
  footer: string;
  printedAt: string;
  client: PrintFact[];
  amounts: PrintFact[];
  dates: PrintFact[];
  pickup: PrintFact | null;
  descriptionTitle: string;
  descriptionLines: string[];
};

export type QuotePrintModel = {
  documentTitle: string;
  kind: "Presupuesto";
  reference: string;
  title: string;
  branding: PrintBranding;
  details: PrintFact[];
  client: PrintFact[];
  service: string | null;
  description: string | null;
  files: string[];
  fileCountLabel: string;
};
