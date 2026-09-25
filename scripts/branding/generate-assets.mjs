// Run from the repository root: node scripts/branding/generate-assets.mjs
// Derive browser assets from the supplied Gestcopy PNG using Next.js's sharp.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const icon = await readFile("app/icon.png");
await sharp(icon).resize(180, 180).png().toFile("app/apple-icon.png");

// Multi-resolution ICO, including the small sizes used in browser tabs.
const sizes = [16, 32, 48];
const images = await Promise.all(
  sizes.map((size) => sharp(icon).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await writeFile("app/favicon.ico", Buffer.concat([header, ...images]));

const card = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f9fafb"/>
  <rect width="1200" height="12" fill="#353dea"/>
  <image x="88" y="110" width="112" height="112" href="data:image/png;base64,${icon.toString("base64")}"/>
  <g font-family="Arial, Helvetica, sans-serif">
    <text x="88" y="340" font-size="88" font-weight="700" fill="#0f172a">Gestcopy</text>
    <text x="92" y="408" font-size="34" fill="#475569">Tu copistería, organizada.</text>
    <text x="92" y="518" font-size="26" fill="#475569">Pedidos · Presupuestos · Clientes · Equipo</text>
  </g>
</svg>`);
const social = await sharp(card).png().toBuffer();
await writeFile("app/opengraph-image.png", social);
await writeFile("app/twitter-image.png", social);
for (const name of ["opengraph-image", "twitter-image"]) {
  await writeFile(`app/${name}.alt.txt`, "Gestcopy. Tu copistería, organizada: pedidos, presupuestos, clientes y equipo.\n");
}
