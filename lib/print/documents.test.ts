import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { OrderPrintDocument } from "@/components/print/order-print-document";
import { QuotePrintDocument } from "@/components/print/quote-print-document";
import { orderPrintModel, printBranding } from "@/lib/print/order-document";
import { quotePrintModel } from "@/lib/print/quote-document";
import type { PrintBranding } from "@/lib/print/types";

const branding: PrintBranding = printBranding({
  displayName: "Taller Norte",
  logoUrl: "/api/tenant/logo",
  brandColor: "#0f3d2e",
});

const signedUrl =
  "https://files.example/download?X-Amz-Signature=secret-token";
const driveUrl = "https://drive.google.com/folders/secret-folder";
const orderId = "42bb0a10-018a-47be-89b8-e23e39a6c0c4";

function orderMarkup() {
  const model = orderPrintModel(
    {
      reference: "DEMO-0200",
      title: "Carteles <VIP>",
      description:
        "<p>Instrucción <strong>urgente</strong> y <em>fina</em>.</p><ul><li>corte</li></ul>",
      notes: "<p>Nota <u>interna</u> <s>vieja</s></p>",
      priority: "urgent",
      received_at: "2026-03-15T10:00:00.000Z",
      due_at: "2026-03-16T10:00:00.000Z",
      ready_at: "2026-03-17T10:00:00.000Z",
      delivered_at: null,
      customer_notification_status: "notified",
      external_folder_url: driveUrl,
      client: {
        name: "Traducciones Nexo",
        company_name: "Nexo SL",
        contact_name: "Ana",
        tax_id: "B12345678",
        email: "ana@nexo.test",
        phone: "600000000",
        notes: "nota privada del cliente",
      },
      service: { name: "Cartelería" },
      store: { name: "Centro" },
      entry_channel: { name: "Mostrador" },
      order_context: { name: "Feria" },
      status: { name: "En producción" },
      assigned_team_member: { name: "Luis" },
      file_status: { name: "Listos" },
      quote_status: { name: "Aceptado" },
      payment_status: { name: "Pendiente" },
      delivery_method: { name: "Recogida" },
    },
    {
      files: ["plano.pdf", "corte.ai", "  ", null],
      branding,
      timeZone: "Europe/Madrid",
    }
  );

  return {
    model,
    html: renderToStaticMarkup(createElement(OrderPrintDocument, { model })),
  };
}

describe("order print document", () => {
  it("prints the work sheet, rich text, notes, files and branding", () => {
    const { model, html } = orderMarkup();

    assert.equal(model.documentTitle, "Pedido DEMO-0200 — Traducciones Nexo");
    assert.match(html, /Taller Norte/);
    assert.match(html, /src="\/api\/tenant\/logo"/);
    assert.match(html, /Carteles &lt;VIP&gt;/);
    assert.match(html, /<strong>urgente<\/strong>/);
    assert.match(html, /<em>fina<\/em>/);
    assert.match(html, /<u>interna<\/u>/);
    assert.match(html, /<s>vieja<\/s>/);
    assert.match(html, /Traducciones Nexo/);
    assert.match(html, /Nexo SL/);
    assert.match(html, /ana@nexo\.test/);
    assert.match(html, /Cartelería/);
    assert.match(html, /Feria/);
    assert.match(html, /En producción/);
    assert.match(html, /Urgente/);
    assert.match(html, /Luis/);
    assert.match(html, /Recepción/);
    assert.match(html, /15\/03\/2026/);
    assert.match(html, /Terminado/);
    assert.equal(html.includes("Entregado"), false);
    assert.match(html, /Listos/);
    assert.match(html, /Presupuesto del pedido/);
    assert.match(html, /Avisado/);
    assert.match(html, /Recogida/);
    assert.match(html, /Notas internas/);
    assert.match(html, /2 archivos/);
    assert.match(html, /plano\.pdf/);
    assert.match(html, />Imprimir</);
    assert.match(html, />Cerrar</);
  });

  it("omits activity, identifiers, signed urls, drive links and client secrets", () => {
    const { model, html } = orderMarkup();
    const serialized = JSON.stringify(model);

    for (const secret of [
      orderId,
      signedUrl,
      driveUrl,
      "B12345678",
      "nota privada del cliente",
      "storage_key",
      "Actividad",
      "Gestcopy",
      "SUR4",
    ]) {
      assert.equal(serialized.includes(secret), false, secret);
      assert.equal(html.includes(secret), false, secret);
    }
  });

  it("falls back to the tenant name and skips a light brand color", () => {
    const light = printBranding({
      displayName: "Copyflow Demo",
      logoUrl: null,
      brandColor: "#f4f4f4",
    });
    assert.equal(light.displayName, "Copyflow Demo");
    assert.equal(light.logoUrl, null);
    assert.equal(light.brandColor, null);
  });
});

describe("quote print document", () => {
  it("prints the customer sheet without notes, assignee, prices or conversion", () => {
    const model = quotePrintModel(
      {
        reference: "P-014",
        title: "2 < 5 vinilos",
        description:
          '<p>Acabado <strong>mate</strong> <a href="https://cliente.test/ref">referencia</a></p>',
        notes: "SECRETO INTERNO",
        valid_until: "2026-04-01",
        created_at: "2026-03-15T10:00:00.000Z",
        statusName: "Enviado",
        serviceName: "Vinilo",
        assigneeName: "Responsable oculto",
        convertedOrderReference: "DEMO-0999",
        client: {
          name: "Clínica Sol",
          company_name: "Sol Salud",
          contact_name: "Marta",
          tax_id: "B87654321",
          email: "marta@sol.test",
          phone: "611111111",
        },
      },
      {
        files: ["fachada.pdf"],
        branding,
        timeZone: "Europe/Madrid",
      }
    );
    const html = renderToStaticMarkup(createElement(QuotePrintDocument, { model }));

    assert.equal(model.documentTitle, "Presupuesto P-014 — Clínica Sol");
    assert.match(html, /Taller Norte/);
    assert.match(html, /src="\/api\/tenant\/logo"/);
    assert.match(html, /2 &lt; 5 vinilos/);
    assert.match(html, /<strong>mate<\/strong>/);
    assert.match(html, /Válido hasta/);
    assert.match(html, /2026/);
    assert.match(html, /Enviado/);
    assert.match(html, /Vinilo/);
    assert.match(html, /B87654321/);
    assert.match(html, /marta@sol\.test/);
    assert.match(html, /1 archivo/);
    assert.match(html, /fachada\.pdf/);
    assert.equal(html.includes("SECRETO INTERNO"), false);
    assert.equal(html.includes("Responsable oculto"), false);
    assert.equal(html.includes("DEMO-0999"), false);
    assert.equal(html.includes("Subtotal"), false);
    assert.equal(html.includes("IVA"), false);
    assert.equal(html.includes("Actividad"), false);
    assert.equal(JSON.stringify(model).includes("SECRETO INTERNO"), false);
  });

  it("omits validity when valid_until is empty", () => {
    const model = quotePrintModel(
      {
        reference: "P-001",
        description: "<p>Texto</p>",
        valid_until: null,
        created_at: "2026-03-15T10:00:00.000Z",
        statusName: "Borrador",
        client: { name: "Ana" },
      },
      { files: [], branding, timeZone: "Europe/Madrid" }
    );
    const html = renderToStaticMarkup(createElement(QuotePrintDocument, { model }));
    assert.equal(html.includes("Válido hasta"), false);
    assert.match(html, /0 archivos/);
  });
});

describe("print routes", () => {
  it("keeps order print on the same membership gate as the order read", () => {
    const page = readFileSync(
      new URL("../../app/orders/[id]/print/page.tsx", import.meta.url),
      "utf8"
    );
    const loader = readFileSync(
      new URL("./load-order.ts", import.meta.url),
      "utf8"
    );
    const header = readFileSync(
      new URL("../../components/orders/detail/order-header.tsx", import.meta.url),
      "utf8"
    );

    assert.match(loader, /getCurrentContext\(\)/);
    assert.match(loader, /\.eq\("tenant_id", context\.tenant\.id\)/);
    assert.match(page, /forbidden\(\)/);
    assert.match(page, /title:\s*\{\s*absolute:/);
    assert.equal(loader.includes("activity"), false);
    assert.match(header, /Imprimir pedido/);
    assert.match(header, /\/orders\/\$\{order\.id\}\/print/);
    assert.match(header, /target="_blank"/);
  });

  it("keeps quote print behind the quotes feature and operative roles", () => {
    const page = readFileSync(
      new URL("../../app/quotes/[id]/print/page.tsx", import.meta.url),
      "utf8"
    );
    const loader = readFileSync(
      new URL("./load-quote.ts", import.meta.url),
      "utf8"
    );
    const detail = readFileSync(
      new URL("../../app/quotes/[id]/page.tsx", import.meta.url),
      "utf8"
    );
    const layout = readFileSync(
      new URL("../../app/quotes/layout.tsx", import.meta.url),
      "utf8"
    );
    const css = readFileSync(
      new URL("../../components/print/print.css", import.meta.url),
      "utf8"
    );

    assert.match(loader, /requireQuotesAccess\(\)/);
    assert.match(loader, /status === 404/);
    assert.match(page, /notFound\(\)/);
    assert.match(page, /forbidden\(\)/);
    assert.match(layout, /canAccessQuotesModule/);
    assert.match(layout, /notFound\(\)/);
    assert.match(detail, /Imprimir presupuesto/);
    assert.match(detail, /\/quotes\/\$\{quote\.id\}\/print/);
    assert.match(loader, /company_name, contact_name, tax_id, email, phone/);
    assert.equal(loader.includes("quote.notes"), true);
    assert.equal(css.includes("size: A4"), true);
    assert.match(css, /\.print-toolbar[\s\S]*display:\s*none/);
    assert.equal(page.includes("· Gestcopy"), false);
  });
});
