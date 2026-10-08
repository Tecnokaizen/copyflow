import sanitizeHtml from "sanitize-html";
import { normalizeRichText, isSafeLinkHref } from "./html";

export type RichTextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  href?: string;
};

/** Project only the shared editor's sanitized vocabulary; never render raw HTML. */
export function richTextLines(value: string): RichTextRun[][] {
  const html = normalizeRichText(value);
  if (!html) return [];
  const lines: RichTextRun[][] = [];
  let current: RichTextRun[] = [];
  const marks: { tag: string; href?: string }[] = [];
  const lists: { ordered: boolean; count: number }[] = [];
  const paragraphs: number[] = [];
  let prefixOnly = false;
  function flush() {
    if (current.length) {
      current[0].text = current[0].text.trimStart();
      current[current.length - 1].text = current[current.length - 1].text.trimEnd();
    }
    lines.push(current.filter((run) => run.text));
    current = [];
    prefixOnly = false;
  }
  // The callbacks see canonical HTML from the existing sanitizer, including safe hrefs.
  sanitizeHtml(html, {
    onOpenTag(tag, attrs) {
      if (tag === "p") {
        if (current.length && !prefixOnly) flush();
        paragraphs.push(lines.length);
      } else if (tag === "br") {
        flush();
      } else if (tag === "ul" || tag === "ol") {
        if (current.length) flush();
        lists.push({ ordered: tag === "ol", count: 0 });
      } else if (tag === "li") {
        if (current.length) flush();
        const list = lists[lists.length - 1];
        if (list) {
          list.count++;
          current.push({ text: list.ordered ? `${list.count}. ` : "• " });
          prefixOnly = true;
        }
      } else if (["strong", "em", "u", "s", "a"].includes(tag)) {
        marks.push({ tag, href: tag === "a" && isSafeLinkHref(attrs.href) ? attrs.href : undefined });
      }
    },
    onCloseTag(tag) {
      if (tag === "p") {
        const start = paragraphs.pop();
        if (current.length || lines.length === start) flush();
      } else if (tag === "li") {
        if (current.length) flush();
      } else if (tag === "ul" || tag === "ol") {
        if (current.length) flush();
        lists.pop();
      } else {
        const index = marks.findLastIndex((mark) => mark.tag === tag);
        if (index >= 0) marks.splice(index, 1);
      }
    },
    textFilter(escaped) {
      // sanitize-html already decoded every entity, then escaped these three for HTML.
      const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">" };
      const text = escaped.replace(/&(amp|lt|gt);/g, (entity) => entities[entity]).replace(/\s+/g, " ");
      if (text) {
        current.push({
          text,
          bold: marks.some((mark) => mark.tag === "strong"),
          italic: marks.some((mark) => mark.tag === "em"),
          underline: marks.some((mark) => mark.tag === "u"),
          strike: marks.some((mark) => mark.tag === "s"),
          href: marks.findLast((mark) => mark.href)?.href,
        });
        prefixOnly = false;
      }
      return escaped;
    },
  });
  if (current.length) flush();
  return lines;
}

export function richTextLineStats(value: string) {
  const lines = richTextLines(value);
  return {
    chars: lines.map((line) => line.map((run) => run.text).join("")).join("\n").length,
    lines: lines.length,
  };
}
