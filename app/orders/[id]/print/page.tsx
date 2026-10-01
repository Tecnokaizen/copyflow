import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { OrderPrintDocument } from "@/components/print/order-print-document";
import "@/components/print/print.css";
import { loadOrderPrint } from "@/lib/print/load-order";

export const instant = false;

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadOrderPrint(id);
  return {
    title: {
      absolute: loaded.status === "ok" ? loaded.model.documentTitle : "Pedido",
    },
  };
}

export default async function OrderPrintPage({ params }: PageProps) {
  const { id } = await params;
  const loaded = await loadOrderPrint(id);
  if (loaded.status === "denied") forbidden();
  if (loaded.status !== "ok") notFound();

  return <OrderPrintDocument model={loaded.model} />;
}
