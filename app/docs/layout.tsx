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
import { loadHelpDocument } from "@/lib/help/content";

function navigation() {
  const sections: HelpNavSection[] = HELP_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    articles: section.articles.map((article) => ({
      slug: article.slug,
      title: article.title,
    })),
  }));
  const articles: HelpNavArticle[] = allHelpArticles().map((article) => {
    const document = loadHelpDocument(article.slug);
    return {
      slug: article.slug,
      title: article.title,
      description: article.description,
      sectionId: article.section.id,
      sectionTitle: article.section.title,
      text: `${article.title}\n${article.description}\n${document?.body ?? ""}`.toLowerCase(),
    };
  });
  return { sections, articles };
}

export const metadata: Metadata = {
  title: "Centro de ayuda Gestcopy",
  description:
    "Cómo usar Gestcopy: pedidos, clientes, presupuestos y configuración.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  const { sections, articles } = navigation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/docs" className="text-sm font-semibold tracking-tight">
            Centro de ayuda Gestcopy
          </Link>
          <ThemeSwitcher />
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
          <HelpNavigation sections={sections} articles={articles} />
        </div>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
