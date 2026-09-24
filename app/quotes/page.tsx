import { Suspense } from "react";
import { QuotesList } from "@/components/quotes/quotes-list";

export default function QuotesPage() {
  return (
    <Suspense fallback={null}>
      <QuotesList />
    </Suspense>
  );
}
