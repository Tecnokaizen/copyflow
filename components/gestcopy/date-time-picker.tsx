"use client";

import { useState } from "react";
import { DatePicker } from "@/components/gestcopy/date-picker";
import {
  addLocalCivilDays,
  combineDateTimeLocal,
  isClockTime,
  splitDateTimeLocal,
  withDefaultDeliveryHour,
} from "@/lib/gestcopy/date-value";
import {
  fromDateTimeLocalValue,
  MISSING_LOCAL_HOUR_MESSAGE,
} from "@/lib/orders/format";
import { TimePicker } from "@/components/gestcopy/time-picker";

type DateTimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  onValidityChange?: (invalid: boolean) => void;
};

export function DateTimePicker({
  value,
  onChange,
  disabled = false,
  id,
  onValidityChange,
}: DateTimePickerProps) {
  const parsed = splitDateTimeLocal(value);
  const [draft, setDraft] = useState<{ date: string; time: string } | null>(
    null
  );
  const draftValue = draft ? combineDateTimeLocal(draft.date, draft.time) : null;
  const showDraft =
    draft !== null &&
    (draftValue === value || (value === "" && draftValue === "") ||
      (draftValue !== null && draftValue !== "" && !fromDateTimeLocalValue(draftValue)));
  const date = showDraft && draft ? draft.date : parsed.date;
  const time = showDraft && draft ? draft.time : parsed.time;
  const timeInvalid = time !== "" && !isClockTime(time);
  const combined = combineDateTimeLocal(date, time);
  const missingHour =
    combined !== "" && fromDateTimeLocalValue(combined) === null;

  function publish(nextDate: string, nextTime: string) {
    setDraft({ date: nextDate, time: nextTime });
    const complete = combineDateTimeLocal(nextDate, nextTime);
    // A partial selection must never be treated as "Quitar fecha".
    // Clearing the stored date is only possible through the explicit button.
    if (!complete) {
      onValidityChange?.(Boolean(nextDate || nextTime));
      return;
    }
    if (!fromDateTimeLocalValue(complete)) {
      onValidityChange?.(true);
      return;
    }
    onValidityChange?.(false);
    onChange(complete);
  }

  function updateDate(nextDate: string) {
    // Use a default hour for a newly selected date; preserve any existing hour.
    publish(nextDate, withDefaultDeliveryHour(nextDate, time));
  }

  function updateTime(nextTime: string) {
    publish(date, nextTime);
  }

  function clear() {
    setDraft(null);
    onValidityChange?.(false);
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
        <div className="gc-field sm:w-40">
          <span className="gc-field-label">Hora</span>
          <TimePicker value={time} onChange={updateTime} disabled={disabled} invalid={timeInvalid || missingHour} />
        </div>
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
      {missingHour ? (
        <p className="text-sm text-destructive" role="alert">
          {MISSING_LOCAL_HOUR_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}
