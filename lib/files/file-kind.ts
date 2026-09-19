export type FileVisualKind =
  | "pdf"
  | "image"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "archive"
  | "design"
  | "text"
  | "generic";

const KIND_BY_EXT: Record<string, FileVisualKind> = {
  pdf: "pdf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
  tif: "image",
  tiff: "image",
  heic: "image",
  heif: "image",
  svg: "image",
  doc: "document",
  docx: "document",
  odt: "document",
  rtf: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  csv: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  ai: "design",
  eps: "design",
  psd: "design",
  indd: "design",
  txt: "text",
};

export function fileKindFromFilename(filename: string): FileVisualKind {
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : "";
  return KIND_BY_EXT[ext] ?? "generic";
}

export function fileKindLabel(kind: FileVisualKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "image":
      return "Imagen";
    case "document":
      return "Documento";
    case "spreadsheet":
      return "Hoja de cálculo";
    case "presentation":
      return "Presentación";
    case "archive":
      return "Comprimido";
    case "design":
      return "Diseño";
    case "text":
      return "Texto";
    default:
      return "Archivo";
  }
}
