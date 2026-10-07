"use client";

import { useState } from "react";

export function ContextualActivity({
  count,
  loading = false,
  defaultOpen = false,
  children,
}: React.PropsWithChildren<{
  count: number;
  loading?: boolean;
  defaultOpen?: boolean;
}>) {
  const [open, setOpen] = useState(defaultOpen);
  const label = loading ? "Actividad" : `Actividad · ${count}`;

  return (
    <section className="gc-card">
      <h2 className="m-0">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-5 py-5 text-left sm:px-6"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="gc-section-title">{label}</span>
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
      </h2>
      {open ? (
        <div className="border-t border-border/70 px-5 py-2 sm:px-6">{children}</div>
      ) : null}
    </section>
  );
}
