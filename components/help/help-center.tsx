"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { parseHelpMarkdown } from "@/lib/help/markdown";
import { cn } from "@/lib/utils";

export type HelpNavArticle = {
  slug: string;
  title: string;
  description: string;
  sectionId: string;
  sectionTitle: string;
  text: string;
};

export type HelpNavSection = {
  id: string;
  title: string;
  articles: { slug: string; title: string }[];
};

export function HelpSearch({ articles }: { articles: HelpNavArticle[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return articles
      .filter((article) => article.text.includes(needle))
      .slice(0, 8);
  }, [articles, query]);

  return (
    <div className="relative">
      <label className="grid gap-1.5 text-sm">
        Buscar
        <input
          className="gc-field-control"
          value={query}
          placeholder="Pedidos, clientes, facturación…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {results.length > 0 ? (
        <ul className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover p-1 shadow-md">
          {results.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/docs/${article.slug}`}
                className="block rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                onClick={() => setQuery("")}
              >
                {article.title}
              </Link>
            </li>
          ))}
        </ul>
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
                    href={`/docs/${article.slug}`}
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
  const currentSlug = pathname.startsWith("/docs/")
    ? pathname.slice("/docs/".length)
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

export function HelpArticleBody({ source }: { source: string }) {
  const blocks = parseHelpMarkdown(source);
  const toc = blocks.filter((block) => block.type === "h2");
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_12rem]">
      <article className="max-w-3xl space-y-3 text-sm leading-relaxed text-foreground sm:text-base">
        {blocks.map((block, index) => {
          if (block.type === "h2") {
            return (
              <h2 id={block.id} key={block.id} className="pt-4 text-xl font-semibold">
                {block.text}
              </h2>
            );
          }
          if (block.type === "h3") {
            return (
              <h3 id={block.id} key={block.id} className="pt-2 text-lg font-semibold">
                {block.text}
              </h3>
            );
          }
          if (block.type === "ul") {
            return (
              <ul key={index} className="list-disc space-y-1 pl-5">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          }
          return <p key={index}>{block.text}</p>;
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
                  <a href={`#${item.id}`} className="text-sm text-muted-foreground hover:text-foreground">
                    {item.text}
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
