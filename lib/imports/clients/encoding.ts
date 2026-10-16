export type DetectedEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "windows-1252";

/**
 * Decodes a text export. UTF-8 (with or without BOM) first; Excel "Unicode
 * text" exports are UTF-16 LE with BOM; anything that is not valid UTF-8 is
 * read as Windows-1252, the usual encoding of Spanish desktop software.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: DetectedEncoding } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8-bom" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}
