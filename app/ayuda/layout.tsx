import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  HelpNavigation,
  type HelpNavArticle,
  type HelpNavSection,
} from "@/components/help/help-center";
import { HELP_SECTIONS, allHelpArticles } from "@/lib/help/catalog";
import { helpSearchIndex } from "@/lib/help/content";

function navigation() {
  const sections: HelpNavSection[] = HELP_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    articles: section.articles.map((article) => ({
      slug: article.slug,
      title: article.title,
    })),
  }));
  const index = helpSearchIndex();
  const bySlug = new Map(index.map((item) => [item.slug, item]));
  const articles: HelpNavArticle[] = allHelpArticles().map((article) => {
    const entry = bySlug.get(article.slug);
    return {
      slug: article.slug,
      title: article.title,
      description: article.description,
      keywords: article.keywords,
      sectionId: article.section.id,
      sectionTitle: article.section.title,
      text: entry?.text ?? `${article.title}\n${article.description}`.toLowerCase(),
    };
  });
  return { sections, articles };
}

export const metadata: Metadata = {
  title: "Centro de ayuda",
  description:
    "Cómo usar Gestcopy en el día a día: pedidos, clientes, presupuestos, equipo y configuración.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  const { sections, articles } = navigation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/80 dark:bg-secondary">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/ayuda" className="text-sm font-semibold tracking-tight">
            Centro de ayuda Gestcopy
          </Link>
          <ThemeSwitcher />
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto dark:rounded-lg dark:border dark:border-border dark:bg-secondary dark:p-3">
          <HelpNavigation sections={sections} articles={articles} />
        </div>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
