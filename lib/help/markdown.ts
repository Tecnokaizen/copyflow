export type HelpBlock =
  | { type: "h2" | "h3"; text: string; id: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

/**
 * Plain-text subset. Headings, paragraphs and lists are stored as strings.
 * The help UI renders those strings as React text, so raw HTML and script
 * in content/help stay escaped and are not executed.
 */
export function parseHelpMarkdown(source: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let list: string[] = [];

  function flushList() {
    if (list.length === 0) return;
    blocks.push({ type: "ul", items: list });
    list = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushList();
      const text = trimmed.slice(4).trim();
      blocks.push({ type: "h3", text, id: headingId(text) });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      const text = trimmed.slice(3).trim();
      blocks.push({ type: "h2", text, id: headingId(text) });
      continue;
    }
    if (trimmed.startsWith("- ")) {
      list.push(trimmed.slice(2).trim());
      continue;
    }
    flushList();
    blocks.push({ type: "p", text: trimmed });
  }
  flushList();
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
