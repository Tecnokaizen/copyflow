import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { quoteDocumentModel } from "../lib/quotes/pdf/model";
import { renderQuotePdf } from "../lib/quotes/pdf/render";
import { anfreFixture } from "../lib/quotes/pdf/fixture";
async function main() {
  const directory = resolve(process.env.PDF_OUTPUT_DIR || "output/pdf"); await mkdir(directory, { recursive: true });
  const f = anfreFixture(); const model = quoteDocumentModel(f.reference, f.version, f.items);
  const logo = await sharp(Buffer.from('<svg width="160" height="70" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="70" rx="10" fill="#163b4c"/><text x="80" y="47" text-anchor="middle" font-family="sans-serif" font-size="38" font-weight="bold" fill="white">GC</text></svg>')).png().toBuffer();
  await writeFile(resolve(directory, "quote-anfre-v1.pdf"), await renderQuotePdf(model, logo));
  const many = { ...model, items: Array.from({ length: 160 }, (_, i) => ({ ...model.items[i % 4], id: `item-${i}`, position: i + 1,
    concept: `${i + 1}. ${model.items[i % 4].concept}`, description: "Descripción de partida para comprobar continuidad de tabla y márgenes." })),
    version: { ...model.version, subtotal: "20826.40", tax_total: "4373.60", total: "25200.00", tax_breakdown: [{ tax_rate: "21", subtotal: "20826.40", tax_amount: "4373.60", total: "25200.00" }] } };
  await writeFile(resolve(directory, "quote-many-items-v1.pdf"), await renderQuotePdf(many, logo));
  console.log(JSON.stringify({ directory, total: model.version.total, items: many.items.length }));
}
void main();
