import type { ReactNode } from "react";
import { PrintLogo, PrintToolbar } from "@/components/print/print-toolbar";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import type { PrintBranding, PrintFact } from "@/lib/print/types";

export function PrintFrame({
  branding,
  kind,
  reference,
  referenceNote = null,
  receiptHref,
  notice = null,
  sheetClassName,
  children,
}: {
  branding: PrintBranding;
  kind: string;
  reference: string;
  /** A short line under the reference (the store of the ficha work sheet). */
  referenceNote?: string | null;
  /** Order work sheet: lets the user open the customer receipt instead. */
  receiptHref?: string;
  /** Shown on screen only, never printed (N23). */
  notice?: string | null;
  sheetClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="print-document">
      <PrintToolbar receiptHref={receiptHref} />
      {notice ? (
        <p className="print-notice print-screen-only" role="status">
          {notice}
        </p>
      ) : null}
      <article
        className={sheetClassName ? `print-sheet ${sheetClassName}` : "print-sheet"}
        style={
          branding.brandColor
            ? { borderTopColor: branding.brandColor }
            : undefined
        }
      >
        <header className="print-header">
          <div className="print-brand">
            {branding.logoUrl ? (
              <PrintLogo src={branding.logoUrl} alt={branding.displayName} />
            ) : null}
            <div>
              {branding.displayName ? (
                <p className="print-business">{branding.displayName}</p>
              ) : null}
              <p className="print-kind">{kind}</p>
            </div>
          </div>
          {referenceNote ? (
            <div className="print-reference-block">
              <p className="print-reference">{reference}</p>
              <p className="print-reference-note">{referenceNote}</p>
            </div>
          ) : (
            <p className="print-reference">{reference}</p>
          )}
        </header>
        {children}
      </article>
    </div>
  );
}

export function PrintFacts({
  title,
  rows,
}: {
  title: string;
  rows: PrintFact[];
}) {
  if (rows.length === 0) return null;

  return (
    <section className="print-block">
      <h2 className="print-section-title">{title}</h2>
      <dl className="print-facts">
        {rows.map((row) => (
          <div className="print-fact" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function PrintRichText({
  title,
  value,
  textStyles = false,
}: {
  title: string;
  value: string | null;
  /** Print the stored text sizes and colors (order instructions and notes). */
  textStyles?: boolean;
}) {
  if (!value) return null;

  return (
    <section className="print-block print-rich">
      <h2 className="print-section-title">{title}</h2>
      <RichTextContent value={value} textStyles={textStyles} />
    </section>
  );
}

export function PrintFiles({
  countLabel,
  files,
}: {
  countLabel: string;
  files: string[];
}) {
  return (
    <section className="print-block">
      <h2 className="print-section-title">Archivos</h2>
      <p className="print-muted">{countLabel}</p>
      {files.length > 0 ? (
        <ul className="print-files">
          {files.map((name, index) => (
            <li key={`${name}-${index}`}>{name}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
