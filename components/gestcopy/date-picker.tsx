"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { es } from "react-day-picker/locale";
import * as Popover from "@radix-ui/react-popover";
import "react-day-picker/style.css";
import {
  addLocalCivilDays,
  civilDateToLocalDate,
  formatCivilDate,
  localDateToCivil,
} from "@/lib/gestcopy/date-value";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  clearable?: boolean;
  showShortcuts?: boolean;
};

export function DatePicker({
  value,
  onChange,
  disabled = false,
  id,
  placeholder = "Elegir fecha",
  clearable = true,
  showShortcuts = true,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const selected = civilDateToLocalDate(value) ?? undefined;
  const label = value ? formatCivilDate(value) : "";

  function choose(date: Date | undefined) {
    if (!date) {
      onChange("");
      setOpen(false);
      return;
    }

    onChange(localDateToCivil(date));
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        ref={setTrigger}
        id={id}
        type="button"
        disabled={disabled}
        className={cn(
          "gc-field-control flex min-h-11 w-full items-center gap-2 rounded-xl text-left disabled:opacity-50",
          !label && "text-muted-foreground"
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1">{label || placeholder}</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal container={trigger?.closest("dialog") ?? undefined}>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="gc-picker-panel w-auto max-w-[calc(100vw-2rem)]"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selecciona la fecha</p>
          <DayPicker
            mode="single"
            fixedWeeks
            showOutsideDays
            locale={es}
            weekStartsOn={1}
            selected={selected}
            defaultMonth={selected}
            onSelect={choose}
            className="gc-day-picker"
          />
          {showShortcuts ? (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              <button
                type="button"
                className="gc-chip"
                onClick={() => {
                  onChange(addLocalCivilDays(0));
                  setOpen(false);
                }}
              >
                Hoy
              </button>
              <button type="button" className="gc-chip" onClick={() => { onChange(addLocalCivilDays(1)); setOpen(false); }}>Mañana</button>
              {clearable ? (
                <button
                  type="button"
                  className="gc-chip"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  Quitar fecha
                </button>
              ) : null}
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
