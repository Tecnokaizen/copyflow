"use client";

import { useId, useState } from "react";
import { DatePicker } from "@/components/gestcopy/date-picker";
import {
  addLocalCivilDays,
  combineDateTimeLocal,
  isClockTime,
  quarterHourOptions,
  splitDateTimeLocal,
} from "@/lib/gestcopy/date-value";
import { cn } from "@/lib/utils";

const HOURS = quarterHourOptions();

type DateTimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
};

export function DateTimePicker({
  value,
  onChange,
  disabled = false,
  id,
}: DateTimePickerProps) {
  const listId = useId();
  const parsed = splitDateTimeLocal(value);
  const [date, setDate] = useState(parsed.date);
  const [time, setTime] = useState(parsed.time);
  const [tracked, setTracked] = useState(value);

  if (value !== tracked && value !== "") {
    setTracked(value);
    setDate(parsed.date);
    setTime(parsed.time);
  } else if (
    value !== tracked &&
    value === "" &&
    combineDateTimeLocal(date, time) !== ""
  ) {
    setTracked("");
    setDate("");
    setTime("");
  } else if (value !== tracked) {
    setTracked(value);
  }

  const timeInvalid = time !== "" && !isClockTime(time);

  function publish(nextDate: string, nextTime: string) {
    onChange(combineDateTimeLocal(nextDate, nextTime));
  }

  function updateDate(nextDate: string) {
    setDate(nextDate);
    publish(nextDate, time);
  }

  function updateTime(nextTime: string) {
    setTime(nextTime);
    publish(date, nextTime);
  }

  function clear() {
    setDate("");
    setTime("");
    onChange("");
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="gc-field min-w-0 flex-1">
          <span className="gc-field-label">Fecha</span>
          <DatePicker
            id={id}
            value={date}
            onChange={updateDate}
            disabled={disabled}
            showShortcuts={false}
          />
        </div>
        <label className="gc-field sm:w-36">
          <span className="gc-field-label">Hora</span>
          <input
            type="text"
            inputMode="numeric"
            list={listId}
            placeholder="HH:MM"
            aria-label="Hora"
            aria-invalid={timeInvalid}
            disabled={disabled}
            value={time}
            onChange={(event) => updateTime(event.target.value)}
            className={cn(
              "gc-field-control min-h-11",
              timeInvalid && "border-destructive"
            )}
          />
          <datalist id={listId}>
            {HOURS.map((hour) => (
              <option key={hour} value={hour} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="gc-chip"
          disabled={disabled}
          onClick={() => updateDate(addLocalCivilDays(0))}
        >
          Hoy
        </button>
        <button
          type="button"
          className="gc-chip"
          disabled={disabled}
          onClick={() => updateDate(addLocalCivilDays(1))}
        >
          Mañana
        </button>
        <button type="button" className="gc-chip" disabled={disabled} onClick={clear}>
          Quitar fecha
        </button>
      </div>
    </div>
  );
}
