/* eslint-disable jsx-a11y/alt-text -- react-pdf primitives do not render HTML */
// SUR4 E4: the customer receipt as a server PDF (N9). It reuses the quote PDF
// fonts (registered by lib/quotes/pdf/render), its #144 footer lines and its
// page numbering. Generated on demand and never stored in R2.
import React from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Document, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { FOOTER_BOX_WIDTH, quoteFooterLines } from "@/lib/quotes/pdf/render";
import type { RichTextRun } from "@/lib/rich-text/lines";
import type { CustomerReceiptModel, PrintFact } from "@/lib/print/types";

const MUTED = "#62717d";

const s = StyleSheet.create({
  page: { paddingTop: 105, paddingBottom: 55, paddingHorizontal: 40, fontFamily: "Noto Sans", fontSize: 9, color: "#25333e", lineHeight: 1.45 },
  header: { position: "absolute", top: 30, left: 40, right: 40, borderBottomWidth: 2, paddingBottom: 14, flexDirection: "row", justifyContent: "space-between" },
  logo: { width: 90, height: 42, objectFit: "contain", objectPosition: "left" },
  businessName: { fontSize: 16, fontWeight: 700, maxWidth: 280 },
  ref: { textAlign: "right", fontSize: 10 },
  bold: { fontWeight: 700 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 12 },
  columns: { flexDirection: "row", gap: 22, marginBottom: 18 },
  column: { width: 247 },
  label: { fontSize: 8, color: MUTED, marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.5, borderBottomColor: "#dbe3e8", paddingVertical: 3 },
  rowValue: { fontWeight: 700, textAlign: "right" },
  box: { borderWidth: 1, borderColor: "#25333e", borderRadius: 2, padding: 10, minHeight: 120 },
  paragraph: { marginBottom: 3 },
  footer: { position: "absolute", left: 40, right: 40, fontSize: 8, color: MUTED, lineHeight: 1.35 },
  footerLine: { fontSize: 8, color: MUTED },
});

function FooterRun({ run }: { run: RichTextRun }) {
  const style = {
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? "italic" as const : "normal" as const,
    textDecoration: run.strike && (run.underline || run.href) ? "underline line-through" as const
      : run.strike ? "line-through" as const : run.underline || run.href ? "underline" as const : "none" as const,
    color: run.href ? "#2459a6" : MUTED,
  };
  return run.href ? <Link src={run.href} style={style}>{run.text}</Link>
    : <Text style={style}>{run.text}</Text>;
}

function Rows({ rows }: { rows: PrintFact[] }) {
  return <>{rows.map((row) => (
    <View key={row.label} style={s.row} wrap={false}>
      <Text>{row.label}</Text><Text style={s.rowValue}>{row.value}</Text>
    </View>
  ))}</>;
}

export async function renderCustomerReceiptPdf(model: CustomerReceiptModel, logo?: Buffer, now: Date = new Date()): Promise<Buffer> {
  const footerLines = await quoteFooterLines(model.footer);
  const footerHeight = footerLines.length * 12;
  const pageStyle = footerHeight ? [s.page, { paddingBottom: 58 + footerHeight }] : s.page;

  const buffer = await renderToBuffer(<Document title={model.documentTitle} author={model.businessName}
    creator="Gestcopy" producer="Gestcopy receipt-v1" creationDate={now} modificationDate={now}>
    <Page size="A4" style={pageStyle} wrap>
      <View fixed style={[s.header, { borderBottomColor: model.brandColor }]}>
        {logo ? <Image src={logo} style={s.logo} /> : <Text style={[s.businessName, { color: model.brandColor }]}>{model.businessName}</Text>}
        <View style={s.ref}>
          <Text style={s.bold}>RESGUARDO</Text>
          <Text>{model.reference}</Text>
          <Text>Impreso: {model.printedAt}</Text>
        </View>
      </View>
      <Text style={s.title}>{model.title}</Text>
      <View style={s.columns}>
        <View style={s.column}>
          <Text style={s.label}>CLIENTE</Text>
          {model.client.length
            ? model.client.map((row) => <Text key={row.label} style={row.label === "Nombre" ? s.bold : undefined}>{row.value}</Text>)
            : <Text>Sin cliente</Text>}
        </View>
        <View style={s.column}>
          <Rows rows={model.amounts} />
          <Rows rows={model.dates} />
          {model.pickup ? <Rows rows={[model.pickup]} /> : null}
        </View>
      </View>
      <View style={s.box}>
        <Text style={s.label}>{model.descriptionTitle.toUpperCase()}</Text>
        {model.descriptionLines.length
          ? model.descriptionLines.map((line, index) => <Text key={index} style={s.paragraph}>{line}</Text>)
          : <Text>—</Text>}
      </View>
      {footerLines.length ? (
        <View fixed style={[s.footer, { bottom: 40 }]}>
          {footerLines.map((line, index) => (
            <Text key={index} style={[s.footerLine, { width: FOOTER_BOX_WIDTH }]}>
              {line.map((run, runIndex) => <FooterRun key={runIndex} run={run} />)}
            </Text>
          ))}
        </View>
      ) : null}
    </Page>
  </Document>);

  // Same numbering as the quote PDF: drawn on the already paginated pages.
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
