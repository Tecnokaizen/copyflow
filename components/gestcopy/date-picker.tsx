"use client";

import { useState } from "react";
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
  const selected = civilDateToLocalDate(value) ?? undefined;
  const label = value ? formatCivilDate(value) : "";

  function choose(date: Date | undefined) {
    if (!date) {
      onChange("");
      return;
    }

    onChange(localDateToCivil(date));
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        type="button"
        disabled={disabled}
        className={cn(
          "gc-field-control flex min-h-11 w-full items-center justify-between text-left disabled:opacity-50",
          !label && "text-muted-foreground"
        )}
      >
        {label || placeholder}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-auto rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <DayPicker
            mode="single"
            locale={es}
            weekStartsOn={1}
            selected={selected}
            defaultMonth={selected}
            onSelect={choose}
            className="gc-day-picker"
          />
          {showShortcuts ? (
            <div className="mt-3 flex flex-wrap gap-2">
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
