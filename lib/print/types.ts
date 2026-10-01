export type PrintFact = {
  label: string;
  value: string;
};

export type PrintBranding = {
  displayName: string;
  logoUrl: string | null;
  brandColor: string | null;
};

export type OrderPrintModel = {
  documentTitle: string;
  kind: "Pedido";
  reference: string;
  title: string;
  branding: PrintBranding;
  client: PrintFact[];
  order: PrintFact[];
  dates: PrintFact[];
  description: string | null;
  production: PrintFact[];
  payment: PrintFact[];
  notes: string | null;
  files: string[];
  fileCountLabel: string;
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
