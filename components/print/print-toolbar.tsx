"use client";

import { useState } from "react";
import { FileText, Printer } from "lucide-react";

export function PrintToolbar({ receiptHref }: { receiptHref?: string } = {}) {
  if (!receiptHref) {
    return (
      <div className="print-toolbar">
        <button type="button" onClick={() => window.print()}>
          Imprimir
        </button>
        <button type="button" onClick={() => window.close()}>
          Cerrar
        </button>
      </div>
    );
  }

  // SUR4 E4: the order prints two documents. The work sheet is this page
  // (browser print); the customer receipt is a server PDF in a new tab.
  return (
    <div className="print-toolbar" role="toolbar" aria-label="Imprimir pedido">
      <button
        type="button"
        onClick={() => window.print()}
        title="Imprimir la hoja de trabajo interna"
      >
        <Printer className="print-toolbar-icon" aria-hidden="true" />
        Hoja de trabajo
      </button>
      <a
        className="print-toolbar-link"
        href={receiptHref}
        target="_blank"
        rel="noopener noreferrer"
        title="Abrir el resguardo para el cliente (PDF)"
      >
        <FileText className="print-toolbar-icon" aria-hidden="true" />
        Resguardo
      </a>
      <button type="button" onClick={() => window.close()}>
        Cerrar
      </button>
    </div>
  );
}

export function PrintLogo({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="print-logo"
      onError={() => setFailed(true)}
    />
  );
}
