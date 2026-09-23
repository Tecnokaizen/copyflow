"use client";

import { FileDropzone } from "./file-dropzone";
import { FileUploadItem } from "./file-upload-item";
import { type ClientUploadItem, formatMaxFileMiB } from "@/lib/files/client";

export function CreateOrderFiles({ items, busy, saved, maxFileBytes, onAdd, onRemove }: {
  items: ClientUploadItem[];
  busy: boolean;
  saved: boolean;
  maxFileBytes: number;
  onAdd: (files: File[]) => void;
  onRemove: (localId: string) => void;
}) {
  return (
    <section className="grid min-w-0 gap-3" aria-label="Archivos adjuntos">
      <p className="text-sm font-medium">Archivos adjuntos</p>
      {!saved ? <>
        <p className="text-xs text-muted-foreground">Se subirán al crear el pedido. El estado operativo de archivos se gestiona por separado.</p>
        <FileDropzone disabled={busy} maxSizeLabel={formatMaxFileMiB(maxFileBytes)} onFilesSelected={onAdd} />
      </> : null}
      <div className="grid min-w-0 gap-2" aria-live="polite">
        {items.map((item) => (
          <div key={item.localId} className="min-w-0">
            <FileUploadItem item={item} />
            {!saved && !busy ? (
              <button type="button" className="gc-action mt-1 min-h-11" onClick={() => onRemove(item.localId)} aria-label={`Quitar ${item.file.name}`}>Quitar de la cola</button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
