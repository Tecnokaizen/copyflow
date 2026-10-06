import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderFileRow } from "@/components/files/order-file-row";
import type { OrderFileDto } from "@/lib/files/client";

function file(name: string, status: OrderFileDto["status"] = "ready"): OrderFileDto {
  return {
    id: "file-1",
    original_name: name,
    content_type: "application/octet-stream",
    size_bytes: 1200,
    status,
    created_at: "2026-09-29T12:00:00.000Z",
    completed_at: "2026-09-29T12:00:00.000Z",
    uploaded_by: null,
    uploader_name: null,
  };
}

function row(
  item: OrderFileDto,
  options: { canMutate?: boolean; onPreview?: () => void } = {},
) {
  return renderToStaticMarkup(
    createElement(OrderFileRow, {
      file: item,
      canMutate: options.canMutate ?? true,
      onDownload: () => {},
      onPreview: options.onPreview,
      onDelete: () => {},
    }),
  );
}

describe("file row preview wiring", () => {
  it("offers preview for a ready PDF and keeps download and delete", () => {
    const html = row(file("contrato.pdf"), { onPreview: () => {} });
    assert.match(html, />Ver</);
    assert.match(html, />Descargar</);
    assert.match(html, />Eliminar</);
    assert.match(html, /<button[^>]*>contrato\.pdf<\/button>/);
  });

  it("hides preview for svg, docx, zip and pending files", () => {
    for (const item of [
      file("logo.svg"),
      file("nota.docx"),
      file("paquete.zip"),
      file("contrato.pdf", "pending"),
    ]) {
      const html = row(item, { onPreview: () => {} });
      assert.equal(html.includes(">Ver<"), false, item.original_name);
      assert.match(html, />Descargar</);
    }
  });

  it("keeps print sheets free of preview controls and signed urls", () => {
    for (const file of [
      "components/print/order-print-document.tsx",
      "components/print/quote-print-document.tsx",
      "components/print/print-frame.tsx",
      "app/orders/[id]/print/page.tsx",
      "app/quotes/[id]/print/page.tsx",
    ]) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      assert.equal(source.includes("preview_url"), false, file);
      assert.equal(source.includes("onPreview"), false, file);
      assert.equal(source.includes(">Ver<"), false, file);
    }
    const orderHeader = readFileSync(
      new URL("../../components/orders/detail/order-header.tsx", import.meta.url),
      "utf8",
    );
    const quotePage = readFileSync(
      new URL("../../components/quotes/quote-commercial-editor.tsx", import.meta.url),
      "utf8",
    );
    assert.match(orderHeader, /Imprimir pedido/);
    assert.match(quotePage, /Imprimir presupuesto/);
  });

  it("keeps preview on an archived row and hides delete", () => {
    const html = row(file("foto.png"), {
      canMutate: false,
      onPreview: () => {},
    });
    assert.match(html, />Ver</);
    assert.match(html, />Descargar</);
    assert.equal(html.includes(">Eliminar<"), false);
  });
});
