"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Stacked dialogs (history, then «Suprimir texto»): Escape closes only the top one.
const openDialogs: symbol[] = [];

/**
 * Modal shell for the post-it dialogs, with the same look as ConfirmDialog.
 * Escape closes it unless `busy`; focus moves into the dialog when it opens.
 */
export function NotesDialog({
  title,
  description,
  children,
  footer,
  busy = false,
  wide = false,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  busy?: boolean;
  wide?: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    const token = Symbol("notes-dialog");
    openDialogs.push(token);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || openDialogs[openDialogs.length - 1] !== token || busyRef.current) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openDialogs.splice(openDialogs.indexOf(token), 1);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-lg outline-none",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        <div className="min-w-0 overflow-y-auto p-5">
          <h3 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h3>
          {description ? <div className="mt-2 text-sm text-muted-foreground">{description}</div> : null}
          {children ? <div className="mt-4 min-w-0">{children}</div> : null}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border/70 px-5 py-4 sm:flex-row sm:justify-end">
          {footer}
        </div>
      </div>
    </div>
  );
}
