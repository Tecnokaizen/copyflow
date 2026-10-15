import type { Metadata } from "next";
import Link from "next/link";
import { ChangelogTimeline } from "@/components/help/changelog";
import { HELP_DOCS_URL } from "@/lib/help/catalog";
import {
  CHANGELOG,
  changelogCounts,
  formatChangelogDate,
} from "@/lib/help/changelog";

const NOVEDADES_URL = `${HELP_DOCS_URL}/novedades`;

export const metadata: Metadata = {
  // The help layout sets a plain title, so the root "%s · Gestcopy" template
  // no longer reaches this segment.
  title: { absolute: "Novedades · Gestcopy" },
  description:
    "Todas las funcionalidades nuevas, mejoras y correcciones de Gestcopy desde su lanzamiento.",
  alternates: { canonical: NOVEDADES_URL },
  openGraph: { url: NOVEDADES_URL },
};

export default function ChangelogPage() {
  const latest = CHANGELOG[0];
  const first = CHANGELOG[CHANGELOG.length - 1];

  return (
    <div className="max-w-3xl">
      <nav aria-label="Migas" className="text-sm text-muted-foreground">
        <Link href="/ayuda" className="hover:text-foreground">
          Centro de ayuda
        </Link>
        <span aria-hidden="true"> / </span>
        <span>Novedades</span>
      </nav>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Novedades</h1>
      <p className="mt-2 text-muted-foreground">
        Todo lo que ha cambiado en Gestcopy desde el{" "}
        {formatChangelogDate(first.date)}: funcionalidades nuevas, mejoras,
        correcciones y refuerzos de seguridad, de lo más reciente a lo más
        antiguo.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Última actualización:{" "}
        <time dateTime={latest.date} className="font-medium text-foreground">
          {formatChangelogDate(latest.date)}
        </time>
      </p>
      <div className="mt-6">
        <ChangelogTimeline releases={CHANGELOG} counts={changelogCounts()} />
      </div>
    </div>
  );
}
