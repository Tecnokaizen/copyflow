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
  return walkHelpFiles().map((file) => {
    const raw = readFileSync(file.absolute, "utf8");
    const body = stripFrontmatter(raw);
    return {
      slug: file.slug,
      title: file.title,
      description: file.description,
      text: `${file.title}\n${file.description}\n${body}`.toLowerCase(),
    };
  });
}

function walkHelpFiles() {
  return allHelpArticles().map((article) => ({
    ...article,
    absolute: path.join(HELP_ROOT, article.file),
  }));
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
