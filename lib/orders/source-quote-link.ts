/**
 * Whether an order was created by converting a quote, as a bare boolean.
 *
 * `convert_quote_to_order` stamps `orders.metadata.source = "quote"` in the same
 * transaction that sets `quotes.converted_order_id`. Only that one JSON path is
 * selected and only a boolean leaves this helper, so the order API keeps never
 * exposing `metadata`. Tenant scoping is explicit and RLS still applies.
 */
type OrderSourceQuery = {
  select: (columns: "quote_origin:metadata->>source") => {
    eq: (column: "id", value: string) => {
      eq: (column: "tenant_id", value: string) => {
        maybeSingle: () => PromiseLike<{
          data: { quote_origin?: unknown } | null;
          error: unknown;
        }>;
      };
    };
  };
};

/** Structural on purpose: avoids deep generic instantiation of the Supabase client. */
type OrderSourceReader = { from: (table: "orders") => unknown };

export async function orderComesFromQuote(
  supabase: OrderSourceReader,
  tenantId: string,
  orderId: string
): Promise<boolean> {
  const query = supabase.from("orders") as OrderSourceQuery;
  const { data, error } = await query
    .select("quote_origin:metadata->>source")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return false;
  return data.quote_origin === "quote";
}
