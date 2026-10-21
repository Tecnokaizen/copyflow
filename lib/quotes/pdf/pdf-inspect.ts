// Test/evidence only. Never imported by production code.
// Reads what a page actually draws: text, position, right edge and fill color.
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFPage } from "pdf-lib";

export type DrawnLine = { y: number; x: number; right: number; text: string; color: string };
type Matrix = [number, number, number, number, number, number];
type FontInfo = { bytes: 1 | 2; decode: (code: number) => string; width: (code: number) => number };

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

function streamText(pdf: PDFDocument, value: unknown): string {
  const object = value instanceof PDFRawStream ? value : pdf.context.lookup(value as never);
  return object instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(object).decode()).toString("latin1") : "";
}

// Ligatures map to several code units written with spaces, e.g. <0066 0069> for "fi".
function utf16(hex: string) {
  return Buffer.from(hex.replace(/\s/g, ""), "hex").swap16().toString("utf16le");
}

function fontInfo(pdf: PDFDocument, dict: PDFDict): FontInfo {
  const unicode = new Map<number, string>();
  const toUnicode = dict.get(PDFName.of("ToUnicode"));
  if (toUnicode) {
    const cmap = streamText(pdf, toUnicode);
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, code, value] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) unicode.set(parseInt(code, 16), utf16(value));
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const [, from, to, target] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
        const start = parseInt(from, 16), end = parseInt(to, 16);
        const values = target.startsWith("[") ? [...target.matchAll(/<([0-9a-fA-F\s]+)>/g)].map((m) => utf16(m[1])) : null;
        for (let code = start; code <= end; code++) {
          if (values) unicode.set(code, values[code - start] ?? "");
          else unicode.set(code, String.fromCodePoint(parseInt(target.slice(1, -1), 16) + code - start));
        }
      }
    }
  }
  const widths = new Map<number, number>();
  let defaultWidth = 0;
  const descendants = dict.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
  if (descendants) {
    const cid = pdf.context.lookup(descendants.get(0), PDFDict);
    defaultWidth = cid.lookupMaybe(PDFName.of("DW"), PDFNumber)?.asNumber() ?? 1000;
    const w = cid.lookupMaybe(PDFName.of("W"), PDFArray)?.asArray().map((item) => pdf.context.lookup(item) ?? item) ?? [];
    for (let i = 0; i < w.length;) {
      const first = (w[i] as PDFNumber).asNumber(), next = w[i + 1];
      if (next instanceof PDFArray) {
        next.asArray().forEach((value, index) => widths.set(first + index, (value as PDFNumber).asNumber()));
        i += 2;
      } else {
        for (let code = first; code <= (next as PDFNumber).asNumber(); code++) widths.set(code, (w[i + 2] as PDFNumber).asNumber());
        i += 3;
      }
    }
    return { bytes: 2, decode: (code) => unicode.get(code) ?? "�", width: (code) => widths.get(code) ?? defaultWidth };
  }
  // pdf-lib standard fonts (the page counter): WinAnsi bytes, no width table.
  return { bytes: 1, decode: (code) => unicode.get(code) ?? String.fromCharCode(code), width: () => 0 };
}

/** Text drawn on a page grouped by baseline, top to bottom, in PDF points (origin bottom left). */
export function drawnLines(pdf: PDFDocument, page: PDFPage): DrawnLine[] {
  const fonts = new Map<string, FontInfo>();
  const fontDict = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
  for (const [name, ref] of fontDict?.entries() ?? []) fonts.set(name.asString().replace(/^\//, ""), fontInfo(pdf, pdf.context.lookup(ref, PDFDict)));
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  const source = refs.map((ref) => streamText(pdf, ref)).join("\n");
  const tokens = source.match(/\[[^\]]*\]|<[0-9A-Fa-f]*>|\/[^\s/[\]<>()]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z*'"]+/g) ?? [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0], tm: Matrix = [1, 0, 0, 1, 0, 0], lm: Matrix = tm;
  const stack: Matrix[] = [];
  let color = "", font: FontInfo | undefined, size = 0, leading = 0;
  const runs: { x: number; y: number; right: number; text: string; color: string }[] = [];
  const operands: string[] = [];
  const show = (parts: (string | number)[]) => {
    const origin = multiply(tm, ctm);
    let text = "", advance = 0;
    for (const part of parts) {
      if (typeof part === "number") { advance -= part / 1000 * size; continue; }
      for (let i = 0; i + (font?.bytes ?? 1) <= part.length / 2; i += font?.bytes ?? 1) {
        const code = parseInt(part.slice(i * 2, (i + (font?.bytes ?? 1)) * 2), 16);
        text += font?.decode(code) ?? "";
        advance += (font?.width(code) ?? 0) / 1000 * size;
      }
    }
    runs.push({ x: origin[4], y: origin[5], right: origin[4] + advance * Math.abs(ctm[0]), text, color });
    tm = multiply([1, 0, 0, 1, advance, 0], tm);
  };
  for (const token of tokens) {
    if (!/^[A-Za-z*'"]+$/.test(token)) { operands.push(token); continue; }
    const n = operands.map(Number);
    if (token === "q") stack.push(ctm);
    else if (token === "Q") ctm = stack.pop() ?? ctm;
    else if (token === "cm") ctm = multiply(n.slice(-6) as Matrix, ctm);
    else if (token === "BT") tm = lm = [1, 0, 0, 1, 0, 0];
    else if (token === "Tm") tm = lm = n.slice(-6) as Matrix;
    else if (token === "Td") tm = lm = multiply([1, 0, 0, 1, n[0], n[1]], lm);
    else if (token === "T*") tm = lm = multiply([1, 0, 0, 1, 0, -leading], lm);
    else if (token === "TL") leading = n[0];
    else if (token === "Tf") { font = fonts.get(operands[0].slice(1)); size = n[1]; }
    else if (token === "scn" || token === "rg") color = n.slice(-3).map((value) => value.toFixed(2)).join(" ");
    else if (token === "Tj") show([operands[0].slice(1, -1)]);
    else if (token === "TJ") show((operands[0].match(/<[0-9A-Fa-f]*>|[-+]?(?:\d+\.?\d*|\.\d+)/g) ?? [])
      .map((part) => part.startsWith("<") ? part.slice(1, -1) : Number(part)));
    operands.length = 0;
  }
  const lines = new Map<string, typeof runs>();
  for (const run of runs) {
    const key = run.y.toFixed(1);
    lines.set(key, [...(lines.get(key) ?? []), run]);
  }
  return [...lines.values()].map((group) => {
    group.sort((a, b) => a.x - b.x);
    return { y: group[0].y, x: group[0].x, right: Math.max(...group.map((run) => run.right)), text: group.map((run) => run.text).join(""), color: group[0].color };
  }).sort((a, b) => b.y - a.y);
}
