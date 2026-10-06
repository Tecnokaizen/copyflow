"use client";
import { useParams } from "next/navigation";
import { QuoteCommercialEditor } from "@/components/quotes/quote-commercial-editor";
export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <QuoteCommercialEditor key={id} quoteId={id} />;
}
