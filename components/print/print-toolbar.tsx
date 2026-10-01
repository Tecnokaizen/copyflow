"use client";

import { useState } from "react";

export function PrintToolbar() {
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
