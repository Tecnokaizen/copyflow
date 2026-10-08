/* eslint-disable jsx-a11y/alt-text -- react-pdf primitives do not render HTML */
import React from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { join } from "node:path";
import { Document, Font, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { richTextToPlainText } from "@/lib/rich-text/html";
import { richTextLines, type RichTextRun } from "@/lib/rich-text/lines";
import { documentDate, documentMoney, documentUnitPrice, documentNumber, type DocumentParty, type QuoteDocumentModel } from "./model";

Font.register({ family: "Noto Sans", fonts: [
  { src: join(process.cwd(), "assets/fonts/noto-sans-latin-400-normal.woff"), fontWeight: 400 },
  { src: join(process.cwd(), "assets/fonts/noto-sans-latin-700-normal.woff"), fontWeight: 700 },
  { src: join(process.cwd(), "assets/fonts/noto-sans-latin-400-italic.woff"), fontWeight: 400, fontStyle: "italic" },
  { src: join(process.cwd(), "assets/fonts/noto-sans-latin-700-italic.woff"), fontWeight: 700, fontStyle: "italic" },
] });
Font.registerHyphenationCallback((word) => [word]);
const s = StyleSheet.create({
  page: { paddingTop: 105, paddingBottom: 55, paddingHorizontal: 40, fontFamily: "Noto Sans", fontSize: 9, color: "#25333e", lineHeight: 1.45 },
  header: { position: "absolute", top: 30, left: 40, right: 40, borderBottomWidth: 2, paddingBottom: 14, flexDirection: "row", justifyContent: "space-between" },
  logo: { width: 90, height: 42, objectFit: "contain", objectPosition: "left" },
  sellerName: { fontSize: 16, fontWeight: 700, maxWidth: 280 },
  ref: { textAlign: "right", fontSize: 10 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 12 },
  parties: { flexShrink: 0, flexDirection: "row", gap: 22, marginBottom: 20 },
  party: { width: 250 }, label: { fontSize: 8, color: "#62717d", marginBottom: 4 },
  bold: { fontWeight: 700 }, description: { marginBottom: 15 },
  columns: { flexShrink: 0, flexDirection: "row", padding: 7, backgroundColor: "#edf2f5", fontSize: 8, fontWeight: 700 },
  row: { flexShrink: 0, flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dbe3e8", padding: 7 },
  concept: { width: 190, paddingRight: 8 }, qty: { width: 50, textAlign: "right", paddingRight: 5 },
  price: { width: 95, textAlign: "right", paddingRight: 5 }, discount: { width: 45, textAlign: "right", paddingRight: 5 },
  tax: { width: 35, textAlign: "right", paddingRight: 5 }, amount: { width: 86, textAlign: "right" },
  small: { fontSize: 8, color: "#62717d", marginTop: 3 },
  totals: { flexShrink: 0, marginTop: 18, width: 300, marginLeft: 215 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 9, fontSize: 13, fontWeight: 700 },
  terms: { marginTop: 22 }, footer: { position: "absolute", bottom: 25, left: 40, right: 40, fontSize: 8, color: "#62717d", flexDirection: "row", justifyContent: "space-between" },
  quoteFooter: { position: "absolute", left: 40, right: 40, fontSize: 8, color: "#62717d", lineHeight: 1.35 },
  quoteFooterLine: { fontSize: 8, color: "#62717d" },
});

// Conservative width also fits the widest bold glyphs. Reserve every wrapped line.
const FOOTER_WRAP_CHARS = 60;
function wrapFooterLine(runs: RichTextRun[]): RichTextRun[][] {
  const line = runs.map((run) => run.text).join("");
  if (!line) return [[{ text: " " }]];
  if (line.length <= FOOTER_WRAP_CHARS) return [runs];
  const wrapped: string[] = [];
  let rest = line;
  while (rest.length > FOOTER_WRAP_CHARS) {
    const space = rest.lastIndexOf(" ", FOOTER_WRAP_CHARS);
    const cut = space > 0 ? space : FOOTER_WRAP_CHARS;
    wrapped.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) wrapped.push(rest);
  let cursor = 0;
  return wrapped.map((part) => {
    const start = line.indexOf(part, cursor), end = start + part.length;
    cursor = end;
    let offset = 0;
    return runs.flatMap((run) => {
      const from = Math.max(start - offset, 0), to = Math.min(end - offset, run.text.length);
      offset += run.text.length;
      return to > from ? [{ ...run, text: run.text.slice(from, to) }] : [];
    });
  });
}

function FooterRun({ run }: { run: RichTextRun }) {
  const style = {
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? "italic" as const : "normal" as const,
    textDecoration: run.strike && (run.underline || run.href) ? "underline line-through" as const
      : run.strike ? "line-through" as const : run.underline || run.href ? "underline" as const : "none" as const,
    color: run.href ? "#2459a6" : "#62717d",
  };
  return run.href ? <Link src={run.href} style={style}>{run.text}</Link>
    : <Text style={style}>{run.text}</Text>;
}
function Party({ label, party }: { label: string; party: DocumentParty }) {
  return <View style={s.party}><Text style={s.label}>{label}</Text><Text style={s.bold}>{party.name}</Text>
    {[party.contact, party.taxId && `NIF: ${party.taxId}`, party.address, party.email, party.phone].filter(Boolean).map((value, i) => <Text key={i}>{value}</Text>)}
  </View>;
}
export async function renderQuotePdf(model: QuoteDocumentModel, logo?: Buffer): Promise<Buffer> {
  const { version: v } = model;
  const revision = v.version_number > 1 ? ` · Revisión ${v.version_number}` : "";
  const money = (value: string) => documentMoney(value, v.currency);
  const footerLines = model.footer
    ? richTextLines(model.footer).flatMap(wrapFooterLine)
    : [];
  const footerHeight = footerLines.length * 12;
  const pageStyle = footerHeight
    ? [s.page, { paddingBottom: 58 + footerHeight }]
    : s.page;
  // PDF metadata derives from locked_at, never wall clock, so retries are byte-identical.
  const date = new Date(v.locked_at!);
  const buffer = await renderToBuffer(<Document title={`Presupuesto ${model.reference}${revision}`} author={model.seller.name}
    creator="Gestcopy" producer="Gestcopy commercial-v1" creationDate={date} modificationDate={date}>
    <Page size="A4" style={pageStyle} wrap>
      <View fixed style={[s.header, { borderBottomColor: model.brandColor }]}>
        {logo ? <Image src={logo} style={s.logo} /> : <Text style={[s.sellerName, { color: model.brandColor }]}>{model.seller.name}</Text>}
        <View style={s.ref}><Text style={s.bold}>PRESUPUESTO</Text><Text>{model.reference}{revision}</Text>
          <Text>Emisión: {documentDate(v.issue_date)}</Text><Text>Validez: {documentDate(v.valid_until)}</Text></View>
      </View>
      <Text style={s.title}>{v.title || "Presupuesto"}</Text>
      <View style={s.parties}><Party label="EMISOR" party={model.seller} /><Party label="CLIENTE / FACTURACIÓN" party={model.client} /></View>
      {model.description ? <Text style={s.description}>{model.description}</Text> : null}
      <Text style={s.small}>Precios unitarios {v.prices_include_tax ? "con IVA incluido" : "sin IVA"}. Importes de partida con IVA.</Text>
      <View style={s.columns} wrap={false}><Text style={s.concept}>Concepto</Text><Text style={s.qty}>Cant.</Text><Text style={s.price}>Precio ud.</Text><Text style={s.discount}>Dto.</Text><Text style={s.tax}>IVA</Text><Text style={s.amount}>Importe</Text></View>
      {model.items.map((item) => <React.Fragment key={item.id}>
        <View style={s.row} wrap={false}><View style={s.concept}><Text style={s.bold}>{item.concept}</Text>{item.unit ? <Text style={s.small}>{item.unit}</Text> : null}</View>
          <Text style={s.qty}>{documentNumber(item.quantity)}</Text><Text style={s.price}>{documentUnitPrice(item.unit_price, v.currency)}</Text><Text style={s.discount}>{documentNumber(item.discount_percent)}%</Text>
          <Text style={s.tax}>{documentNumber(item.tax_rate)}%</Text><Text style={s.amount}>{money(item.total)}</Text></View>
        {item.description ? <Text style={[s.small, { paddingHorizontal: 7, marginBottom: 6 }]}>{richTextToPlainText(item.description)}</Text> : null}
      </React.Fragment>)}
      <View style={s.totals} wrap={false}>
        <View style={s.totalRow}><Text>Subtotal sin IVA</Text><Text>{money(v.subtotal)}</Text></View>
        {v.tax_breakdown.map((tax) => <View key={tax.tax_rate} style={s.totalRow}><Text>IVA {documentNumber(tax.tax_rate)}% · Base {money(tax.subtotal)}</Text><Text>{money(tax.tax_amount)}</Text></View>)}
        <View style={s.totalRow}><Text>IVA total</Text><Text>{money(v.tax_total)}</Text></View>
        <View style={[s.grand, { borderTopColor: model.brandColor }]}><Text>Total</Text><Text>{money(v.total)}</Text></View>
      </View>
      {model.terms ? <View style={s.terms}><Text style={s.label}>CONDICIONES</Text><Text>{model.terms}</Text></View> : null}
      {footerLines.length ? (
        <View fixed style={[s.quoteFooter, { bottom: 40 }]}>
          {footerLines.map((line, index) => (
            <Text key={index} style={[s.quoteFooterLine, { width: 515 }]}>
              {line.map((run, runIndex) => <FooterRun key={runIndex} run={run} />)}
            </Text>
          ))}
        </View>
      ) : null}
      <Text fixed style={{ position: "absolute", bottom: 25, left: 40, width: 400, fontSize: 8, color: "#62717d" }}>{model.reference}{revision} · {v.currency}</Text>
    </Page>
  </Document>);
  // React PDF's dynamic fixed Text reproduces invalid coordinates / missing text
  // on this template. Number the already paginated pages without changing metadata.
  const pdf = await PDFDocument.load(buffer, { updateMetadata: false });
  const counterFont = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  for (const [index, page] of pages.entries()) {
    const label = `${index + 1} / ${pages.length}`;
    page.drawText(label, { x: page.getWidth() - 40 - counterFont.widthOfTextAtSize(label, 8), y: 25,
      size: 8, font: counterFont, color: rgb(0.38, 0.44, 0.49) });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
