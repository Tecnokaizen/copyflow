import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  addLocalCivilDays,
  civilDateToLocalDate,
  combineDateTimeLocal,
  formatCivilDate,
  isClockTime,
  quarterHourOptions,
  splitDateTimeLocal,
} from "./date-value";

describe("civil dates", () => {
  it("rejects empty and impossible dates", () => {
    assert.equal(civilDateToLocalDate(""), null);
    assert.equal(civilDateToLocalDate("2026-02-31"), null);
    assert.equal(formatCivilDate(""), "");
    assert.equal(formatCivilDate("2026-02-31"), "");
  });

  it("formats a valid date in Spanish without turning it into a datetime", () => {
    const label = formatCivilDate("2026-09-23");
    assert.match(label, /23/);
    assert.match(label, /2026/);
    assert.equal(label.includes("T"), false);
    assert.equal(label.includes(":"), false);
  });

  it("clears by combining nothing", () => {
    assert.equal(combineDateTimeLocal("", ""), "");
    assert.equal(combineDateTimeLocal("2026-09-23", ""), "");
    assert.equal(combineDateTimeLocal("", "10:30"), "");
  });
});

describe("date and time", () => {
  it("keeps a complete local value and rejects a partial or invalid hour", () => {
    assert.equal(combineDateTimeLocal("2026-09-23", "10:30"), "2026-09-23T10:30");
    assert.equal(combineDateTimeLocal("2026-09-23", "10:07"), "2026-09-23T10:07");
    assert.equal(combineDateTimeLocal("2026-09-23", "24:00"), "");
    assert.equal(combineDateTimeLocal("2026-09-23", "10:60"), "");
    assert.equal(isClockTime("09:05"), true);
    assert.deepEqual(splitDateTimeLocal("2026-09-23T10:30"), {
      date: "2026-09-23",
      time: "10:30",
    });
    assert.deepEqual(splitDateTimeLocal("2026-09-23"), { date: "", time: "" });
    assert.deepEqual(splitDateTimeLocal(""), { date: "", time: "" });
  });

  it("offers quarter hours and can move a civil day without inventing a time", () => {
    const options = quarterHourOptions();
    assert.equal(options[0], "00:00");
    assert.equal(options.includes("10:15"), true);
    assert.equal(options.includes("10:07"), false);
    assert.equal(options.length, 96);

    const today = addLocalCivilDays(0, new Date(2026, 8, 23, 22, 15));
    const tomorrow = addLocalCivilDays(1, new Date(2026, 8, 23, 22, 15));
    assert.equal(today, "2026-09-23");
    assert.equal(tomorrow, "2026-09-24");
    assert.equal(combineDateTimeLocal(today, ""), "");
  });
});

describe("operational date surfaces", () => {
  it("uses the shared pickers on orders and quotes and leaves the kiosk alone", () => {
    const orderForm = readFileSync(
      new URL("../../components/orders/create-order-form.tsx", import.meta.url),
      "utf8"
    );
    const production = readFileSync(
      new URL("../../components/orders/detail/order-production.tsx", import.meta.url),
      "utf8"
    );
    const quoteForm = readFileSync(
      new URL("../../components/quotes/quote-form.tsx", import.meta.url),
      "utf8"
    );
    const kiosk = readFileSync(
      new URL("../../components/kiosk/kiosk-order-form.tsx", import.meta.url),
      "utf8"
    );

    assert.match(orderForm, /DateTimePicker/);
    assert.match(production, /DateTimePicker/);
    assert.match(quoteForm, /DatePicker/);
    assert.equal(orderForm.includes('type="datetime-local"'), false);
    assert.equal(production.includes('type="datetime-local"'), false);
    assert.equal(quoteForm.includes('type="date"'), false);
    assert.match(kiosk, /type="datetime-local"/);
  });
});
