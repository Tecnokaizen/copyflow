import { Inflate } from "fflate";

import { ImportFileError } from "./errors";
import { CLIENT_IMPORT_MAX_SHEETS, CLIENT_IMPORT_MAX_UNCOMPRESSED_BYTES, CLIENT_IMPORT_MAX_ZIP_ENTRIES } from "./limits";

/**
 * Checks an .xlsx (ZIP) before the reader unpacks it, the same way the reader
 * does: through the central directory (read-excel-file uses fflate.unzipSync).
 *
 *  - Every entry is inflated as a stream and only counted, never kept: the real
 *    expanded size is capped (zip bombs) and must match the declared size, so
 *    the reader cannot be tricked into a bigger allocation later.
 *  - ZIP64, encryption and compression methods other than stored/deflate are
 *    refused: Excel does not use them for files of this size.
 *  - XML parts may not declare a DOCTYPE or entities (entity-expansion attacks)
 *    nor be UTF-16 (which would hide those declarations from this scan).
 *  - At most CLIENT_IMPORT_MAX_SHEETS worksheets.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;
const STORED = 0;
const DEFLATE = 8;
const INFLATE_STEP = 64 * 1024;
const XML_DECLARATION = /<!\s*(DOCTYPE|ENTITY)/i;
const WORKSHEET = /^xl\/worksheets\/[^/]+\.xml$/i;

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
};

const unsafe = () => new ImportFileError("xlsx_unsafe");
const invalid = () => new ImportFileError("invalid_xlsx");

function readCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);

  // End of central directory: 22 bytes plus an optional comment of up to 64 KiB.
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (u32(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw invalid();

  const count = u16(eocd + 10);
  const directorySize = u32(eocd + 12);
  const directoryOffset = u32(eocd + 16);
  if (count === 0xffff || directorySize === ZIP64_MARKER || directoryOffset === ZIP64_MARKER) throw unsafe();
  if (count > CLIENT_IMPORT_MAX_ZIP_ENTRIES) throw unsafe();
  if (directoryOffset + directorySize > eocd) throw invalid();

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > eocd || u32(offset) !== CENTRAL_SIGNATURE) throw invalid();
    const nameLength = u16(offset + 28);
    const extraLength = u16(offset + 30);
    const commentLength = u16(offset + 32);
    const entry: ZipEntry = {
      flags: u16(offset + 8),
      method: u16(offset + 10),
      compressedSize: u32(offset + 20),
      size: u32(offset + 24),
      localOffset: u32(offset + 42),
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
    };
    if (entry.compressedSize === ZIP64_MARKER || entry.size === ZIP64_MARKER || entry.localOffset === ZIP64_MARKER) {
      throw unsafe();
    }
    entries.push(entry);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryData(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localOffset;
  if (header + 30 > bytes.length || view.getUint32(header, true) !== LOCAL_SIGNATURE) throw invalid();
  const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw invalid();
  return bytes.subarray(start, end);
}

/** Streams the entry, counting bytes against the shared budget and scanning XML. */
function inspectEntry(entry: ZipEntry, data: Uint8Array, budget: { used: number }) {
  const isXml = /\.(xml|rels)$/i.test(entry.name);
  const latin1 = new TextDecoder("latin1");
  let produced = 0;
  let tail = "";
  let first = true;

  const take = (chunk: Uint8Array) => {
    if (!chunk.length) return;
    produced += chunk.length;
    budget.used += chunk.length;
    if (budget.used > CLIENT_IMPORT_MAX_UNCOMPRESSED_BYTES) throw new ImportFileError("xlsx_too_large");
    if (!isXml) return;
    if (first) {
      first = false;
      if ((chunk[0] === 0xff && chunk[1] === 0xfe) || (chunk[0] === 0xfe && chunk[1] === 0xff)) throw unsafe();
    }
    // Byte-for-byte decoding keeps the ASCII markup intact; the tail catches a
    // declaration split between two chunks.
    const text = tail + latin1.decode(chunk);
    if (XML_DECLARATION.test(text)) throw unsafe();
    tail = text.slice(-16);
  };

  if (entry.method === STORED) {
    take(data);
  } else {
    const inflate = new Inflate((chunk) => take(chunk));
    for (let offset = 0; offset < data.length; offset += INFLATE_STEP) {
      inflate.push(data.subarray(offset, offset + INFLATE_STEP), offset + INFLATE_STEP >= data.length);
    }
    if (!data.length) inflate.push(new Uint8Array(0), true);
  }
  // The reader allocates by the declared size: it must be the real one.
  if (produced !== entry.size) throw unsafe();
}

export function assertSafeXlsx(bytes: Uint8Array) {
  const entries = readCentralDirectory(bytes);
  let sheets = 0;
  let declared = 0;
  for (const entry of entries) {
    if (entry.flags & 0x1) throw unsafe();
    if (entry.method !== STORED && entry.method !== DEFLATE) throw unsafe();
    declared += entry.size;
    if (WORKSHEET.test(entry.name)) sheets += 1;
  }
  if (sheets > CLIENT_IMPORT_MAX_SHEETS) throw new ImportFileError("too_many_sheets");
  // Cheap early refusal of what the file itself admits to; the streaming pass
  // below catches files that lie about their sizes.
  if (declared > CLIENT_IMPORT_MAX_UNCOMPRESSED_BYTES) throw new ImportFileError("xlsx_too_large");

  const budget = { used: 0 };
  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue;
    try {
      inspectEntry(entry, entryData(bytes, entry), budget);
    } catch (error) {
      if (error instanceof ImportFileError) throw error;
      throw invalid();
    }
  }
}
