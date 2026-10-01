"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import {
  helpPlainText,
  parseHelpInline,
  parseHelpMarkdown,
  type HelpInline,
} from "@/lib/help/markdown";
import { searchHelpArticles } from "@/lib/help/search";
import { cn } from "@/lib/utils";

export type HelpNavArticle = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  sectionId: string;
  sectionTitle: string;
  text: string;
};

export type HelpNavSection = {
  id: string;
  title: string;
  articles: { slug: string; title: string }[];
};

export type HelpRelatedLink = {
  slug: string;
  title: string;
};

export function HelpSearch({ articles }: { articles: HelpNavArticle[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => searchHelpArticles(articles, query, 8),
    [articles, query]
  );
  const showEmpty =
    query.trim().length >= 2 && results.length === 0;

  return (
    <div className="relative">
      <label className="grid gap-1.5 text-sm" htmlFor="help-search">
        Buscar
        <input
          id="help-search"
          className="gc-field-control"
          value={query}
          placeholder="Ej. reasignar pedido, subir archivo…"
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </label>
      {results.length > 0 ? (
        <ul
          className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover p-1 shadow-md"
          aria-label="Resultados de búsqueda"
        >
          {results.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/ayuda/${article.slug}`}
                className="block rounded-sm px-2 py-2 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onClick={() => setQuery("")}
              >
                <span className="font-medium">{article.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {article.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {showEmpty ? (
        <p className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">
          No hay resultados para «{query.trim()}». Prueba con otras palabras, por ejemplo «reasignar» o «invitar».
        </p>
      ) : null}
    </div>
  );
}

export function HelpSidebar({
  sections,
  currentSlug,
}: {
  sections: HelpNavSection[];
  currentSlug?: string;
}) {
  return (
    <nav aria-label="Documentación" className="grid gap-4">
      {sections.map((section) => (
        <div key={section.id}>
          <p className="px-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {section.title}
          </p>
          <ul className="mt-1 grid">
            {section.articles.map((article) => {
              const active = article.slug === currentSlug;
              return (
                <li key={article.slug}>
                  <Link
                    href={`/ayuda/${article.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {article.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function HelpNavigation({
  sections,
  articles,
}: {
  sections: HelpNavSection[];
  articles: HelpNavArticle[];
}) {
  const pathname = usePathname();
  const currentSlug = pathname.startsWith("/ayuda/")
    ? pathname.slice("/ayuda/".length)
    : undefined;

  return (
    <>
      <details className="relative z-20 rounded-md border border-border/80 p-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-medium">Navegación</summary>
        <div className="mt-3 grid gap-4">
          <HelpSearch articles={articles} />
          <HelpSidebar sections={sections} currentSlug={currentSlug} />
        </div>
      </details>
      <div className="relative z-20 hidden gap-4 lg:grid">
        <HelpSearch articles={articles} />
        <HelpSidebar sections={sections} currentSlug={currentSlug} />
      </div>
    </>
  );
}

function HelpInlineText({ text }: { text: string }) {
  return <>{renderHelpInline(parseHelpInline(text))}</>;
}

function renderHelpInline(nodes: HelpInline[], keyPrefix = "h"): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") return node.text;
    if (node.type === "strong") {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {renderHelpInline(node.children, key)}
        </strong>
      );
    }
    if (node.type === "em") {
      return <em key={key}>{renderHelpInline(node.children, key)}</em>;
    }
    if (node.type === "code") {
      return (
        <code
          key={key}
          className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.875em]"
        >
          {node.text}
        </code>
      );
    }
    const external = node.href.startsWith("http");
    return (
      <a
        key={key}
        href={node.href}
        className="text-primary underline-offset-2 hover:underline"
        {...(external
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
      >
        {node.text}
      </a>
    );
  });
}

export function HelpArticleBody({ source }: { source: string }) {
  const blocks = parseHelpMarkdown(source);
  const toc = blocks.filter((block) => block.type === "h2");
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_12rem]">
      <article className="max-w-3xl space-y-4 text-sm leading-relaxed text-foreground sm:text-base">
        {blocks.map((block, index) => {
          if (block.type === "h2") {
            return (
              <h2
                id={block.id}
                key={block.id}
                className="scroll-mt-20 pt-4 text-xl font-semibold tracking-tight"
              >
                <HelpInlineText text={block.text} />
              </h2>
            );
          }
          if (block.type === "h3") {
            return (
              <h3
                id={block.id}
                key={block.id}
                className="scroll-mt-20 pt-2 text-lg font-semibold tracking-tight"
              >
                <HelpInlineText text={block.text} />
              </h3>
            );
          }
          if (block.type === "ul") {
            return (
              <ul key={index} className="list-disc space-y-1.5 pl-5">
                {block.items.map((item, itemIndex) => (
                  <li key={`${itemIndex}-${item}`}>
                    <HelpInlineText text={item} />
                  </li>
                ))}
              </ul>
            );
          }
          if (block.type === "ol") {
            return (
              <ol key={index} className="list-decimal space-y-1.5 pl-5">
                {block.items.map((item, itemIndex) => (
                  <li key={`${itemIndex}-${item}`}>
                    <HelpInlineText text={item} />
                  </li>
                ))}
              </ol>
            );
          }
          return (
            <p key={index}>
              <HelpInlineText text={block.text} />
            </p>
          );
        })}
      </article>
      {toc.length > 1 ? (
        <aside className="hidden lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            En esta página
          </p>
          <ul className="mt-2 grid gap-1">
            {toc.map((item) =>
              item.type === "h2" ? (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    {helpPlainText(item.text)}
                  </a>
                </li>
              ) : null
            )}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}

export function HelpRelated({ links }: { links: HelpRelatedLink[] }) {
  if (links.length === 0) return null;
  return (
    <section className="mt-10 rounded-lg border border-border/80 p-4 dark:bg-card" aria-labelledby="help-related">
      <h2 id="help-related" className="text-base font-semibold">
        Relacionado
      </h2>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.slug}>
            <Link
              href={`/ayuda/${link.slug}`}
              className="text-sm text-primary hover:underline"
            >
              {link.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
