"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";
import { Block } from "@/components/orders/detail/views/parts";
import { cn } from "@/lib/utils";

// View B · Pestañas: four coherent sections instead of splitting the same
// order across Resumen, Trabajo and Archivos. Pinned notes live with post-its,
// and the visual status tracker lives with the work sequence and activity.
//
// Hidden panels remain mounted (`hidden`), preserving upload progress, edit
// drafts and financial state when switching sections.

type TabKey = "work" | "payments" | "notes" | "sequence";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "work", label: "Trabajo" },
  { key: "payments", label: "Cobro y entrega" },
  { key: "notes", label: "Post-its" },
  { key: "sequence", label: "Secuencia de trabajo" },
];

function TabPanel({
  id,
  labelledBy,
  active,
  children,
}: {
  id: string;
  labelledBy: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={!active}
      tabIndex={0}
      // `hidden` alone loses to Tailwind's `flex`: switch display explicitly.
      className={cn(
        "min-w-0 flex-col gap-5 focus-visible:outline-none",
        active ? "flex" : "hidden"
      )}
    >
      {children}
    </div>
  );
}

export function TabsOrderLayout({ modules, facts }: OrderDetailLayoutProps) {
  const [active, setActive] = useState<TabKey>("work");
  // Header «Añadir nota»: reveal «Post-its» before its composer scrolls into view.
  const [handledNoteRequest, setHandledNoteRequest] = useState(facts.noteComposeRequest);
  if (facts.noteComposeRequest !== handledNoteRequest) {
    setHandledNoteRequest(facts.noteComposeRequest);
    if (facts.noteComposeRequest > 0) setActive("notes");
  }
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabId = (key: TabKey) => `${baseId}-tab-${key}`;
  const panelId = (key: TabKey) => `${baseId}-panel-${key}`;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((tab) => tab.key === active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setActive(TABS[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      {modules.notices}
      {modules.header}
      <div
        role="tablist"
        aria-label="Secciones del pedido"
        onKeyDown={onKeyDown}
        className="sticky top-0 z-10 -mx-4 mb-5 grid grid-cols-2 gap-1.5 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:px-0 md:flex md:gap-1 md:py-0"
      >
        {TABS.map((tab, index) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={tabId(tab.key)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab.key)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.key)}
              className={cn(
                // Narrow screens: 2×2 grid, all four visible without scrolling.
                // From md: one row with the underline indicator.
                "min-h-11 min-w-0 rounded-[calc(var(--radius)-4px)] border px-2 text-center text-sm font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:shrink-0 md:whitespace-nowrap md:rounded-none md:border-0 md:border-b-2 md:px-4",
                selected
                  ? "border-primary bg-primary/10 text-foreground md:bg-transparent"
                  : "border-border text-muted-foreground hover:text-foreground md:border-transparent"
              )}
            >
              {tab.label}
              {tab.key === "work" && facts.editing ? (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  · editando
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <TabPanel id={panelId("work")} labelledBy={tabId("work")} active={active === "work"}>
        <Block>{modules.sourceQuote}</Block>
        <Block>{modules.summary}</Block>
        <Block>{modules.production}</Block>
        <Block>{modules.files}</Block>
      </TabPanel>

      <TabPanel id={panelId("payments")} labelledBy={tabId("payments")} active={active === "payments"}>
        <Block>{modules.fulfillment}</Block>
      </TabPanel>

      <TabPanel id={panelId("notes")} labelledBy={tabId("notes")} active={active === "notes"}>
        <Block>{modules.pinnedNotes}</Block>
        <Block>{modules.stickyNotes}</Block>
        <Block>{modules.legacyNotes}</Block>
      </TabPanel>

      <TabPanel id={panelId("sequence")} labelledBy={tabId("sequence")} active={active === "sequence"}>
        <Block>{modules.sequence}</Block>
        <Block>{modules.tracking}</Block>
        <Block>{modules.activity}</Block>
      </TabPanel>
    </>
  );
}
