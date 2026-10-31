import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";

// The current order page, unchanged: fallback and default for every tenant.
export function ClassicOrderLayout({ modules }: OrderDetailLayoutProps) {
  return (
    <>
      {modules.notices}
      {modules.header}
      {modules.pinnedNotes}
      {modules.sequence}
      {modules.tracking}
      {modules.sourceQuote}

      {/* SUR4 E3: main column (work, files, notes, activity) and side column
          (summary, payments and delivery). On mobile the two wrappers dissolve
          (display: contents) and `order-*` gives the single-column order:
          work, summary, files, payments, notes, activity. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:items-start">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          <div className="order-1 min-w-0">{modules.production}</div>
          <div className="order-3 min-w-0">{modules.files}</div>
          <div className="order-5 flex min-w-0 flex-col gap-6 empty:hidden">
            {modules.stickyNotes}
            {modules.legacyNotes}
          </div>
          <div className="order-6 min-w-0">{modules.activity}</div>
        </div>
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          <div className="order-2 min-w-0">{modules.summary}</div>
          <div className="order-4 min-w-0">{modules.fulfillment}</div>
        </div>
      </div>
    </>
  );
}
