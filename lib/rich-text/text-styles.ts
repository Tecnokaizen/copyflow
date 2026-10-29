/**
 * Text styles for rich text fields that opt in (orders): a closed set of sizes
 * and colors on fragments, and paragraph alignment. They are stored as tokens,
 * never as inline CSS: sizes and colors on a `<span>`, alignment on the `<p>`
 * itself. The sanitizer allows exact values only, and each surface (light,
 * dark, print) maps a token to its own CSS. Normal size, the default color and
 * left alignment are the absence of a token, so older text needs no change.
 */
export const TEXT_SIZE_ATTRIBUTE = "data-text-size";
export const TEXT_COLOR_ATTRIBUTE = "data-text-color";
export const TEXT_ALIGN_ATTRIBUTE = "data-text-align";

export const TEXT_SIZES = [
  { value: "small", label: "Pequeño" },
  { value: "large", label: "Grande" },
  { value: "xlarge", label: "Muy grande" },
] as const;

export const TEXT_COLORS = [
  { value: "red", label: "Rojo" },
  { value: "orange", label: "Naranja" },
  { value: "green", label: "Verde" },
  { value: "blue", label: "Azul" },
  { value: "purple", label: "Morado" },
] as const;

/** Left is the default and is never stored. */
export const TEXT_ALIGNS = [
  { value: "center", label: "Centrada" },
  { value: "right", label: "Derecha" },
  { value: "justify", label: "Justificada" },
] as const;

export type TextSize = (typeof TEXT_SIZES)[number]["value"];
export type TextColor = (typeof TEXT_COLORS)[number]["value"];
export type TextAlign = (typeof TEXT_ALIGNS)[number]["value"];

const SIZE_VALUES = new Set<string>(TEXT_SIZES.map((size) => size.value));
const COLOR_VALUES = new Set<string>(TEXT_COLORS.map((color) => color.value));
const ALIGN_VALUES = new Set<string>(TEXT_ALIGNS.map((align) => align.value));

/** Exact token or null: no trimming or case folding, so stored HTML stays canonical. */
export function textSizeOf(value: unknown): TextSize | null {
  return typeof value === "string" && SIZE_VALUES.has(value) ? (value as TextSize) : null;
}

export function textColorOf(value: unknown): TextColor | null {
  return typeof value === "string" && COLOR_VALUES.has(value) ? (value as TextColor) : null;
}

export function textAlignOf(value: unknown): TextAlign | null {
  return typeof value === "string" && ALIGN_VALUES.has(value) ? (value as TextAlign) : null;
}

/** The allowed alignment of a `<p>`; anything else (left included) is dropped. */
export function paragraphStyleAttributes(attribs: Record<string, string | undefined>) {
  const result: Record<string, string> = {};
  const align = textAlignOf(attribs[TEXT_ALIGN_ATTRIBUTE]);
  if (align) result[TEXT_ALIGN_ATTRIBUTE] = align;
  return result;
}

/** The allowed text style attributes of a `<span>`, in a fixed order; anything else is dropped. */
export function textStyleAttributes(attribs: Record<string, string | undefined>) {
  const result: Record<string, string> = {};
  const size = textSizeOf(attribs[TEXT_SIZE_ATTRIBUTE]);
  const color = textColorOf(attribs[TEXT_COLOR_ATTRIBUTE]);
  if (size) result[TEXT_SIZE_ATTRIBUTE] = size;
  if (color) result[TEXT_COLOR_ATTRIBUTE] = color;
  return result;
}
