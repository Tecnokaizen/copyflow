export type HelpBlock =
  | { type: "h2" | "h3"; text: string; id: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

/**
 * Plain-text subset. Headings, paragraphs and lists stay strings.
 * Inline marks are a typed tree (bold, italic, code, safe links). The help
 * UI turns that tree into React elements. Raw HTML stays text and is not executed.
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
  return helpPlainText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type HelpInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: HelpInline[] }
  | { type: "em"; children: HelpInline[] }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

const SAFE_HELP_HREF = /^(https?:\/\/[^\s)]+|\/(?!\/)[^\s)]*|#[^\s)]+)$/;

export function parseHelpInline(source: string): HelpInline[] {
  const nodes: HelpInline[] = [];
  let buffer = "";
  let index = 0;

  function flush() {
    if (buffer.length === 0) return;
    nodes.push({ type: "text", text: buffer });
    buffer = "";
  }

  while (index < source.length) {
    if (source.startsWith("**", index)) {
      const end = source.indexOf("**", index + 2);
      if (end !== -1) {
        flush();
        nodes.push({
          type: "strong",
          children: parseHelpInline(source.slice(index + 2, end)),
        });
        index = end + 2;
        continue;
      }
    }

    if (source[index] === "`") {
      const end = source.indexOf("`", index + 1);
      if (end !== -1) {
        flush();
        nodes.push({ type: "code", text: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (source[index] === "[") {
      const labelEnd = source.indexOf("](", index + 1);
      if (labelEnd !== -1) {
        const hrefEnd = source.indexOf(")", labelEnd + 2);
        if (hrefEnd !== -1) {
          const href = source.slice(labelEnd + 2, hrefEnd).trim();
          if (SAFE_HELP_HREF.test(href)) {
            flush();
            nodes.push({
              type: "link",
              text: source.slice(index + 1, labelEnd),
              href,
            });
            index = hrefEnd + 1;
            continue;
          }
        }
      }
    }

    if (source[index] === "*" && source[index + 1] !== "*") {
      const end = source.indexOf("*", index + 1);
      if (end !== -1 && source[end + 1] !== "*") {
        flush();
        nodes.push({
          type: "em",
          children: parseHelpInline(source.slice(index + 1, end)),
        });
        index = end + 1;
        continue;
      }
    }

    buffer += source[index];
    index += 1;
  }

  flush();
  return nodes;
}

export function helpPlainText(source: string): string {
  return inlinePlainText(parseHelpInline(source));
}

function inlinePlainText(nodes: HelpInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "strong" || node.type === "em") {
        return inlinePlainText(node.children);
      }
      return node.text;
    })
    .join("");
}
