"use client";

import { useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Clock3 } from "lucide-react";
import { isClockTime, quarterHourOptions } from "@/lib/gestcopy/date-value";
import { cn } from "@/lib/utils";

const HOURS = quarterHourOptions();

export function TimePicker({ value, onChange, disabled = false, invalid = false }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Keep an existing non-quarter-hour value intact; never round a saved delivery.
  const options = isClockTime(value) && !HOURS.includes(value)
    ? [...HOURS, value].sort() : HOURS;

  function focusOption(index: number) {
    const option = list.current?.querySelector<HTMLButtonElement>(`[data-time-index="${index}"]`);
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: "nearest" });
  }

  return <Popover.Root open={open} onOpenChange={(next) => {
    if (next) setActiveIndex(Math.max(0, options.indexOf(value || "09:00")));
    setOpen(next);
  }}>
    <Popover.Trigger ref={setTrigger} type="button" disabled={disabled} aria-label="Hora" aria-invalid={invalid}
      className={cn("gc-field-control flex min-h-11 w-full items-center gap-2 rounded-xl text-left disabled:opacity-50", invalid && "border-destructive")}>
      <Clock3 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={cn("flex-1 tabular-nums", !value && "text-muted-foreground")}>{value || "Elegir hora"}</span>
      <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
    </Popover.Trigger>
    <Popover.Portal container={trigger?.closest("dialog") ?? undefined}>
      <Popover.Content side="bottom" align="end" sideOffset={8} collisionPadding={12}
        className="gc-picker-panel w-72 max-w-[calc(100vw-2rem)]"
        onOpenAutoFocus={(event) => { event.preventDefault(); focusOption(activeIndex); }}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Selecciona la hora</p>
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">Cada 15 min</span>
        </div>
        <div ref={list} id={listId} role="listbox" aria-label="Hora de entrega"
          className="grid max-h-60 grid-cols-4 gap-1 overflow-y-auto overscroll-contain p-1">
          {options.map((hour, index) => <button key={hour} type="button" role="option" aria-selected={value === hour}
            data-time-index={index} tabIndex={activeIndex === index ? 0 : -1}
            className={cn("min-h-11 rounded-lg text-sm tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              value === hour && "bg-primary font-semibold text-primary-foreground hover:bg-primary/90")}
            onFocus={() => setActiveIndex(index)} onClick={() => { onChange(hour); setOpen(false); }}
            onKeyDown={(event) => {
              const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 };
              const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                : event.key in offsets ? Math.max(0, Math.min(options.length - 1, index + offsets[event.key])) : null;
              if (next === null) return;
              event.preventDefault(); setActiveIndex(next); focusOption(next);
            }}>{hour}</button>)}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
