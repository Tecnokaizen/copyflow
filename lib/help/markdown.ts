export type HelpBlock =
  | { type: "h2" | "h3"; text: string; id: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

/**
 * Plain-text subset. Headings, paragraphs and lists are stored as strings.
 * The help UI renders those strings as React text, so raw HTML and script
 * in content/help stay escaped and are not executed.
 */
export function parseHelpMarkdown(source: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let unordered: string[] = [];
  let ordered: string[] = [];

  function flushLists() {
    if (unordered.length > 0) {
      blocks.push({ type: "ul", items: unordered });
      unordered = [];
    }
    if (ordered.length > 0) {
      blocks.push({ type: "ol", items: ordered });
      ordered = [];
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushLists();
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushLists();
      const text = trimmed.slice(4).trim();
      blocks.push({ type: "h3", text, id: headingId(text) });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushLists();
      const text = trimmed.slice(3).trim();
      blocks.push({ type: "h2", text, id: headingId(text) });
      continue;
    }
    if (trimmed.startsWith("- ")) {
      if (ordered.length > 0) {
        blocks.push({ type: "ol", items: ordered });
        ordered = [];
      }
      unordered.push(trimmed.slice(2).trim());
      continue;
    }
    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      if (unordered.length > 0) {
        blocks.push({ type: "ul", items: unordered });
        unordered = [];
      }
      ordered.push(orderedMatch[1].trim());
      continue;
    }
    flushLists();
    blocks.push({ type: "p", text: trimmed });
  }
  flushLists();
  return blocks;
}

export function headingId(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
