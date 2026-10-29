import { ORDER_RICH_TEXT } from "@/lib/orders/rich-text";
import { persistRichText } from "@/lib/rich-text/html";
import { NOTE_MAX_HTML_LENGTH, NOTE_MAX_PLAIN_LENGTH } from "@/lib/orders/notes/types";

/**
 * Visible characters of a post-it, counted exactly like the database
 * (public.order_note_plain_length_v1): tags removed, a non-breaking space is a
 * space, any other entity counts as one character, surrounding blanks trimmed.
 */
export function notePlainLength(html: string | null | undefined): number {
  return (html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|#160|#xa0);/gi, " ")
    .replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, "x")
    .replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "").length;
}

/**
 * Server-side sanitization of a post-it body, with the order profile of #146
 * (sizes, colors and alignment). Runs before any RPC: the browser never decides
 * which HTML reaches order_notes.
 */
export function prepareNoteBody(raw: unknown): { ok: true; html: string } | { ok: false } {
  if (typeof raw !== "string" || raw.length > NOTE_MAX_HTML_LENGTH * 2) {
    return { ok: false };
  }
  const html = persistRichText(raw, ORDER_RICH_TEXT);
  if (!html || html.length > NOTE_MAX_HTML_LENGTH) {
    return { ok: false };
  }
  const length = notePlainLength(html);
  if (length < 1 || length > NOTE_MAX_PLAIN_LENGTH) {
    return { ok: false };
  }
  return { ok: true, html };
}
