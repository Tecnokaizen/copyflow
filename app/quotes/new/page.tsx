import { Suspense } from "react";
import { QuoteCreationEditor } from "@/components/quotes/quote-creation-editor";
export default function NewQuotePage() { return <Suspense fallback={<p>Cargando editor…</p>}><QuoteCreationEditor /></Suspense>; }
