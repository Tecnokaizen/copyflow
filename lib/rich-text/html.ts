import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
];

const HTML_TAG = /<\/?(?:p|br|strong|em|u|s|ul|ol|li|a)\b/i;
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    a: ["http", "https", "mailto"],
  },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    b: "strong",
    i: "em",
    strike: "s",
    del: "s",
    a: (tagName, attribs): sanitizeHtml.Tag => {
      if (!isSafeLinkHref(attribs.href)) {
        return { tagName: "span", attribs: {} };
      }
      return { tagName, attribs: { href: attribs.href.trim() } };
    },
  },
};

export function looksLikeHtml(value: string) {
  return HTML_TAG.test(value);
}

export function isSafeLinkHref(value: string | null | undefined) {
  const href = value?.trim() ?? "";
  if (!href || /[\u0000-\u001F\u007F\s]/.test(href)) {
    return false;
  }

  try {
    return SAFE_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

export function normalizeLinkInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return isSafeLinkHref(candidate) ? candidate : null;
}

function escapeText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ");
}

function legacyToHtml(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim()
    .split("\n")
    .map((line) => {
      if (!line.trim()) {
        return "<p><br></p>";
      }
      return `<p>${escapeText(line.trim())}</p>`;
    })
    .join("");
}

function withSafeLinkRel(html: string) {
  return html.replace(/<a\b([^>]*)>/gi, (_match, rawAttrs: string) => {
    const hrefMatch = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(rawAttrs);
    const href = hrefMatch?.[2] ?? hrefMatch?.[3] ?? "";
    if (!isSafeLinkHref(href)) {
      return "<a>";
    }
    return `<a href="${escapeText(href)}" rel="noopener noreferrer">`;
  });
}

export function sanitizeRichText(value: string | null | undefined) {
  const clean = sanitizeHtml(value ?? "", SANITIZE_OPTIONS).trim();
  return withSafeLinkRel(clean);
}

export function richTextToPlainText(value: string | null | undefined) {
  const raw = value ?? "";
  if (!raw) {
    return "";
  }

  if (!looksLikeHtml(raw)) {
    return raw.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
  }

  const html = sanitizeRichText(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|ul|ol)>/gi, "\n");
  const stripped = decodeEntities(html.replace(/<[^>]+>/g, ""));

  return stripped
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function plainTextSnippet(value: string | null | undefined) {
  return richTextToPlainText(value).replace(/\s+/g, " ").trim();
}

export function isRichTextEmpty(value: string | null | undefined) {
  return richTextToPlainText(value).trim().length === 0;
}

export function normalizeRichText(value: string | null | undefined) {
  const raw = value ?? "";
  if (!raw.trim()) {
    return "";
  }

  const html = looksLikeHtml(raw) ? raw : legacyToHtml(raw);
  const clean = sanitizeRichText(html);
  if (isRichTextEmpty(clean)) {
    return "";
  }

  return clean;
}

export function persistRichText(value: string | null | undefined) {
  const html = normalizeRichText(value);
  return html || null;
}

export function appendRichText(
  existing: string | null | undefined,
  addition: string | null | undefined
) {
  const base = normalizeRichText(existing);
  const next = normalizeRichText(addition);
  if (!next) {
    return base;
  }
  if (!base) {
    return next;
  }
  return `${base}${next}`;
}
