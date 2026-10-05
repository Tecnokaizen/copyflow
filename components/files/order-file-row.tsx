"use client";

import {
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Presentation,
  Download,
  Eye,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OrderFileDto } from "@/lib/files/client";
import {
  fileKindFromFilename,
  fileKindLabel,
  type FileVisualKind,
} from "@/lib/files/file-kind";
import { formatFileSize, formatFileTimestamp } from "@/lib/files/format";
import { isPreviewableFilename } from "@/lib/files/preview";
import { cn } from "@/lib/utils";

type OrderFileRowProps = {
  file: OrderFileDto;
  canMutate: boolean;
  downloading?: boolean;
  previewing?: boolean;
  onDownload: () => void;
  onPreview?: () => void;
  onDelete?: () => void;
};

function KindIcon({ kind }: { kind: FileVisualKind }) {
  const className = "size-5 shrink-0 text-muted-foreground";
  switch (kind) {
    case "pdf":
    case "document":
    case "text":
      return <FileText className={className} aria-hidden="true" />;
    case "image":
      return <FileImage className={className} aria-hidden="true" />;
    case "spreadsheet":
      return <FileSpreadsheet className={className} aria-hidden="true" />;
    case "presentation":
      return <Presentation className={className} aria-hidden="true" />;
    case "archive":
      return <FileArchive className={className} aria-hidden="true" />;
    case "design":
      return <File className={className} aria-hidden="true" />;
    default:
      return <File className={className} aria-hidden="true" />;
  }
}

export function OrderFileRow({
  file,
  canMutate,
  downloading = false,
  previewing = false,
  onDownload,
  onPreview,
  onDelete,
}: OrderFileRowProps) {
  const kind = fileKindFromFilename(file.original_name);
  const canPreview =
    file.status === "ready" &&
    Boolean(onPreview) &&
    isPreviewableFilename(file.original_name);
  const meta = [
    fileKindLabel(kind),
    formatFileSize(file.size_bytes),
    file.uploader_name || null,
    formatFileTimestamp(file.completed_at ?? file.created_at),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 sm:px-5",
      )}
    >
      <KindIcon kind={kind} />
      <div className="min-w-0 flex-1">
        {canPreview ? (
          <button
            type="button"
            className="block max-w-full truncate text-left text-sm font-medium text-foreground hover:underline"
            onClick={onPreview}
          >
            {file.original_name}
          </button>
        ) : (
          <p className="truncate text-sm font-medium text-foreground">
            {file.original_name}
          </p>
        )}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        {downloading ? (
          <p className="mt-1 text-xs text-muted-foreground" role="status">
            Preparando descarga…
          </p>
        ) : null}
      </div>

      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        {canPreview ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPreview}
            disabled={previewing}
            aria-label={`Ver ${file.original_name}`}
          >
            <Eye className="size-4" />
            Ver
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDownload}
          disabled={downloading}
          aria-label={`Descargar ${file.original_name}`}
        >
          <Download className="size-4" />
          Descargar
        </Button>
        {canMutate && !file.protected_document && onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={`Eliminar ${file.original_name}`}
          >
            <Trash2 className="size-4" />
            Eliminar
          </Button>
        ) : null}
      </div>

      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={`Acciones de ${file.original_name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canPreview ? (
              <DropdownMenuItem
                disabled={previewing}
                onSelect={() => onPreview?.()}
              >
                Ver
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={downloading}
              onSelect={() => onDownload()}
            >
              Descargar
            </DropdownMenuItem>
            {canMutate && !file.protected_document && onDelete ? (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onDelete()}
              >
                Eliminar
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
