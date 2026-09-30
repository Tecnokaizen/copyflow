import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  allHelpArticles,
  helpArticleBySlug,
  type HelpArticleRef,
  type HelpSection,
} from "@/lib/help/catalog";

const HELP_ROOT = path.join(process.cwd(), "content", "help");

export type HelpDocument = HelpArticleRef & {
  section: HelpSection;
  body: string;
};

export function loadHelpDocument(slug: string): HelpDocument | null {
  const article = helpArticleBySlug(slug);
  if (!article) return null;
  const filePath = path.resolve(HELP_ROOT, article.file);
  if (!filePath.startsWith(HELP_ROOT + path.sep) && filePath !== HELP_ROOT) {
    return null;
  }
  const raw = readFileSync(filePath, "utf8");
  return { ...article, body: stripFrontmatter(raw) };
}

export function helpSearchIndex() {
  return allHelpArticles().map((article) => {
    const document = loadHelpDocument(article.slug);
    const body = document?.body ?? "";
    const keywords = article.keywords.join("\n");
    return {
      slug: article.slug,
      title: article.title,
      description: article.description,
      keywords: article.keywords,
      text: `${article.title}\n${article.description}\n${keywords}\n${body}`.toLowerCase(),
    };
  });
}

function stripFrontmatter(raw: string) {
  if (!raw.startsWith("---\n")) return raw.trim();
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return raw.trim();
  return raw.slice(end + 5).trim();
}

export function helpContentRoot() {
  return HELP_ROOT;
}

export function technicalDocsAreSeparate(helpRoot: string) {
  if (!statSync(helpRoot).isDirectory()) return false;
  const names = readdirSync(helpRoot);
  return path.basename(helpRoot) === "help" && !names.includes("architecture");
}
