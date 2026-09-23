import { StatusBadge } from "@/components/gestcopy/status-badge";
import { quoteStatusTone } from "@/lib/quotes/types";

export function QuoteStatusBadge({
  name,
  code,
}: {
  name: string;
  code?: string | null;
}) {
  return <StatusBadge tone={quoteStatusTone(code)}>{name}</StatusBadge>;
}
