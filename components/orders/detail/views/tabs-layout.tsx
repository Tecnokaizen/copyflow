"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";
import { Block } from "@/components/orders/detail/views/parts";
import { cn } from "@/lib/utils";

// View B · Pestañas. The full header and the pinned post-its stay on top, so
// status, priority, amounts and delivery are always visible; below, one
// section at a time: Resumen, Trabajo, Archivos, Cobros, Actividad.
//
// Hidden tabs stay mounted (`hidden`): «Cobros» loads the amounts the header
// shows, uploads keep running and drafts keep their values.

type TabKey = "summary" | "work" | "files" | "payments" | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "Resumen" },
  { key: "work", label: "Trabajo" },
  { key: "files", label: "Archivos" },
  { key: "payments", label: "Cobros" },
  { key: "activity", label: "Actividad" },
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
      className="flex min-w-0 flex-col gap-5 focus-visible:outline-none"
    >
      {children}
    </div>
  );
}

export function TabsOrderLayout({ modules, facts }: OrderDetailLayoutProps) {
  const [active, setActive] = useState<TabKey>("summary");
  // Header «Añadir nota»: show «Trabajo», where the post-its live, in the same
  // render (the panel scrolls to its composer right after).
  const [handledNoteRequest, setHandledNoteRequest] = useState(facts.noteComposeRequest);
  if (facts.noteComposeRequest !== handledNoteRequest) {
    setHandledNoteRequest(facts.noteComposeRequest);
    if (facts.noteComposeRequest > 0) setActive("work");
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
      <Block className="mb-4">{modules.pinnedNotes}</Block>
      <Block className="mb-4">{modules.tracking}</Block>

      <div
        role="tablist"
        aria-label="Secciones del pedido"
        onKeyDown={onKeyDown}
        className="sticky top-0 z-10 -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:px-0"
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
                "min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
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

      <TabPanel id={panelId("summary")} labelledBy={tabId("summary")} active={active === "summary"}>
        <Block>{modules.sourceQuote}</Block>
        <Block>{modules.summary}</Block>
      </TabPanel>

      <TabPanel id={panelId("work")} labelledBy={tabId("work")} active={active === "work"}>
        <Block>{modules.production}</Block>
        <Block>{modules.sequence}</Block>
        <Block>{modules.stickyNotes}</Block>
        <Block>{modules.legacyNotes}</Block>
      </TabPanel>

      <TabPanel id={panelId("files")} labelledBy={tabId("files")} active={active === "files"}>
        <Block>{modules.files}</Block>
      </TabPanel>

      <TabPanel id={panelId("payments")} labelledBy={tabId("payments")} active={active === "payments"}>
        <Block>{modules.fulfillment}</Block>
      </TabPanel>

      <TabPanel id={panelId("activity")} labelledBy={tabId("activity")} active={active === "activity"}>
        <Block>{modules.activity}</Block>
      </TabPanel>
    </>
  );
}
