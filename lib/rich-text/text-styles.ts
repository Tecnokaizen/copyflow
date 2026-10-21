/**
 * Text styles for rich text fields that opt in (orders): a closed set of sizes
 * and colors. They are stored as tokens on a `<span>`, never as inline CSS, so
 * the sanitizer can allow exact values and each surface (light, dark, print)
 * maps a token to its own readable color. Normal size and the default color
 * are the absence of a token.
 */
export const TEXT_SIZE_ATTRIBUTE = "data-text-size";
export const TEXT_COLOR_ATTRIBUTE = "data-text-color";

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

export type TextSize = (typeof TEXT_SIZES)[number]["value"];
export type TextColor = (typeof TEXT_COLORS)[number]["value"];

const SIZE_VALUES = new Set<string>(TEXT_SIZES.map((size) => size.value));
const COLOR_VALUES = new Set<string>(TEXT_COLORS.map((color) => color.value));

/** Exact token or null: no trimming or case folding, so stored HTML stays canonical. */
export function textSizeOf(value: unknown): TextSize | null {
  return typeof value === "string" && SIZE_VALUES.has(value) ? (value as TextSize) : null;
}

export function textColorOf(value: unknown): TextColor | null {
  return typeof value === "string" && COLOR_VALUES.has(value) ? (value as TextColor) : null;
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
