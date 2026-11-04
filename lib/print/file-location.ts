// Where the order files are, resolved when a document is printed. No stored
// column: it comes from orders.external_folder_url («Ubicación externa de
// archivos») and the real attachments (order_files ready and not deleted).

export const FILE_LOCATION_LABEL = "Ubicación de archivos";
export const ATTACHED_FILES_TEXT = "Archivos adjuntos al pedido";
export const NO_FILES_TEXT = "Sin archivos registrados";
export const EXTERNAL_LOCATION_TEXT = "Ubicación externa registrada";

// Public file-sharing services named on the customer receipt instead of the
// link itself. Matched on the exact host or a subdomain of it.
const KNOWN_PROVIDERS: Array<[string, string]> = [
  ["drive.google.com", "Google Drive"],
  ["docs.google.com", "Google Drive"],
  ["dropbox.com", "Dropbox"],
  ["onedrive.live.com", "OneDrive"],
  ["1drv.ms", "OneDrive"],
  ["sharepoint.com", "OneDrive"],
  ["wetransfer.com", "WeTransfer"],
  ["we.tl", "WeTransfer"],
];

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

/**
 * Internal documents (work sheet): the external location as it was written,
 * which wins over attachments; else whether there are attachments.
 */
export function internalFileLocation(
  externalLocation: string | null | undefined,
  attachedFiles: number
): string {
  return clean(externalLocation) ?? (attachedFiles > 0 ? ATTACHED_FILES_TEXT : NO_FILES_TEXT);
}

/** The file-sharing service of an http(s) URL, when it is a known public one. */
export function knownFileProvider(value: string): string | null {
  let host: string;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    host = url.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [domain, name] of KNOWN_PROVIDERS) {
    if (host === domain || host.endsWith(`.${domain}`)) return name;
  }
  return null;
}

/**
 * Customer receipt: never the location itself. No URL (it may be private or
 * signed), no network path, host, folder or storage key: at most the name of
 * a known public service.
 */
export function customerFileLocation(
  externalLocation: string | null | undefined,
  attachedFiles: number
): string {
  const external = clean(externalLocation);
  if (external) {
    const provider = knownFileProvider(external);
    return provider ? `Ubicación externa (${provider})` : EXTERNAL_LOCATION_TEXT;
  }
  return attachedFiles > 0 ? ATTACHED_FILES_TEXT : NO_FILES_TEXT;
}
