import assert from "node:assert/strict";
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
