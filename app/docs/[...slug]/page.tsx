import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpArticleBody } from "@/components/help/help-center";
import {
  allHelpArticles,
  helpNeighbors,
} from "@/lib/help/catalog";
import { loadHelpDocument } from "@/lib/help/content";

export function generateStaticParams() {
  return allHelpArticles().map((article) => ({
    slug: article.slug.split("/"),
  }));
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const key = slug.join("/");
  const document = loadHelpDocument(key);
  if (!document) notFound();
  const { previous, next } = helpNeighbors(key);

  return (
    <div>
      <nav aria-label="Migas" className="text-sm text-muted-foreground">
        <Link href="/docs" className="hover:text-foreground">
          Centro de ayuda
        </Link>
        <span aria-hidden="true"> / </span>
        <span>{document.section.title}</span>
      </nav>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">{document.title}</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">{document.description}</p>
      <div className="mt-6">
        <HelpArticleBody source={document.body} />
      </div>
      <nav className="mt-10 flex flex-col gap-3 border-t border-border/80 pt-4 sm:flex-row sm:justify-between">
        {previous ? (
          <Link href={`/docs/${previous.slug}`} className="text-sm hover:underline">
            Anterior: {previous.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/docs/${next.slug}`} className="text-sm hover:underline sm:text-right">
            Siguiente: {next.title}
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
