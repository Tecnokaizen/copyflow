import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { WorkSheetDocument } from "@/components/print/order-print-document";
import "@/components/print/print.css";
import { loadWorkSheet } from "@/lib/print/load-order";

export const instant = false;

// SUR4 E2: the order work sheet. The profile (standard or ficha) is decided
// by loadWorkSheet from the tenant features on the server; this page reads
// no search parameters, so nothing in the URL can change it (N25).
type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadWorkSheet(id);
  return {
    title: {
      absolute: loaded.status === "ok" ? loaded.model.documentTitle : "Pedido",
    },
  };
}

export default async function OrderPrintPage({ params }: PageProps) {
  const { id } = await params;
  const loaded = await loadWorkSheet(id);
  if (loaded.status === "denied") forbidden();
  if (loaded.status !== "ok") notFound();

  return (
    <WorkSheetDocument
      model={loaded.model}
      legacyNotes={loaded.legacyNotes}
      receiptHref={`/api/orders/${id}/receipt`}
    />
  );
}
