import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { QuotePrintDocument } from "@/components/print/quote-print-document";
import "@/components/print/print.css";
import { loadQuotePrint } from "@/lib/print/load-quote";

export const instant = false;

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadQuotePrint(id);
  return {
    title: {
      absolute:
        loaded.status === "ok" ? loaded.model.documentTitle : "Presupuesto",
    },
  };
}

export default async function QuotePrintPage({ params }: PageProps) {
  const { id } = await params;
  const loaded = await loadQuotePrint(id);
  if (loaded.status === "denied") forbidden();
  if (loaded.status !== "ok") notFound();

  return <QuotePrintDocument model={loaded.model} />;
}
