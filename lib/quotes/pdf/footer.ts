import { richTextLines, type RichTextRun } from "@/lib/rich-text/lines";

/** Width in points of `text` drawn with the font of `run` (weight and style). */
export type FooterMeasure = (text: string, run: RichTextRun) => number;

function sliceRuns(runs: RichTextRun[], start: number, end: number): RichTextRun[] {
  let offset = 0;
  return runs.flatMap((run) => {
    const from = Math.max(start - offset, 0), to = Math.min(end - offset, run.text.length);
    offset += run.text.length;
    return to > from ? [{ ...run, text: run.text.slice(from, to) }] : [];
  });
}

/**
 * One line typed by the tenant becomes one or more printed lines. A line only
 * wraps when it does not fit the measured width, at a space when it can,
 * otherwise inside the word. Nothing is cut, added or reordered.
 */
export function wrapFooterLine(runs: RichTextRun[], maxWidth: number, measure: FooterMeasure): RichTextRun[][] {
  const line = runs.map((run) => run.text).join("");
  // A blank line between texts keeps its height.
  if (!line) return [[{ text: " " }]];
  const width = (start: number, end: number) =>
    sliceRuns(runs, start, end).reduce((sum, run) => sum + measure(run.text, run), 0);
  const printed: RichTextRun[][] = [];
  let start = 0, end = 0;
  for (const word of line.matchAll(/\S+/g)) {
    const wordStart = word.index, wordEnd = wordStart + word[0].length;
    if (width(start, wordEnd) <= maxWidth) { end = wordEnd; continue; }
    if (end > start) printed.push(sliceRuns(runs, start, end));
    start = wordStart;
    // A word wider than the line (a long URL) is split, never clipped.
    while (width(start, wordEnd) > maxWidth) {
      let cut = start + 1;
      while (cut < wordEnd && width(start, cut + 1) <= maxWidth) cut++;
      // Keep surrogate pairs together.
      if (cut < wordEnd && cut - start > 1 && /[\uDC00-\uDFFF]/.test(line[cut])) cut--;
      printed.push(sliceRuns(runs, start, cut));
      start = cut;
    }
    end = wordEnd;
  }
  if (end > start) printed.push(sliceRuns(runs, start, end));
  return printed;
}

/** Printed footer lines, in the order and with the line breaks the tenant configured. */
export function footerPrintedLines(footer: string, maxWidth: number, measure: FooterMeasure): RichTextRun[][] {
  return footer ? richTextLines(footer).flatMap((runs) => wrapFooterLine(runs, maxWidth, measure)) : [];
}
