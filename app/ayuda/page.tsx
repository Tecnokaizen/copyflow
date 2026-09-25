import type { Metadata } from "next";
import Link from "next/link";
import { HELP_DOCS_URL, HELP_SECTIONS } from "@/lib/help/catalog";

export const metadata: Metadata = {
  alternates: { canonical: HELP_DOCS_URL },
  openGraph: { url: HELP_DOCS_URL },
};

export default function DocsHomePage() {
  return (
    <div>
      <p className="text-sm text-muted-foreground">Gestcopy</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Centro de ayuda Gestcopy</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground">
        Cómo usar Gestcopy en el día a día: pedidos, clientes, presupuestos y
        configuración de tu organización.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {HELP_SECTIONS.map((section) => (
          <section key={section.id} className="rounded-lg border border-border/80 p-4">
            <h2 className="font-semibold">{section.title}</h2>
            <ul className="mt-2 grid gap-1">
              {section.articles.slice(0, 4).map((article) => (
                <li key={article.slug}>
                  <Link
                    href={`/ayuda/${article.slug}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {article.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
