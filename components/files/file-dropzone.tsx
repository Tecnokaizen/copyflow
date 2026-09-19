"use client";

import { useRef } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ORDER_FILE_ACCEPT } from "@/lib/files/client";

type FileDropzoneProps = {
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  className?: string;
};

export function FileDropzone({
  disabled = false,
  onFilesSelected,
  className,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function takeFiles(list: FileList | null) {
    if (!list || list.length === 0 || disabled) return;
    onFilesSelected(Array.from(list));
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors",
        !disabled && "hover:border-foreground/30 hover:bg-muted/50",
        disabled && "opacity-60",
        className,
      )}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        takeFiles(event.dataTransfer.files);
      }}
    >
      <Upload
        className="mx-auto size-8 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="mt-3 text-sm font-medium text-foreground">
        Arrastra archivos aquí
      </p>
      <p className="mt-1 text-sm text-muted-foreground">o</p>
      <div className="mt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="min-h-11"
          onClick={() => inputRef.current?.click()}
        >
          Seleccionar archivos
        </Button>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        PDF, imágenes, Office, ZIP…
        <br />
        Máximo 100 MB por archivo
      </p>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ORDER_FILE_ACCEPT}
        multiple
        disabled={disabled}
        aria-label="Seleccionar archivos para el pedido"
        onChange={(event) => takeFiles(event.target.files)}
      />
    </div>
  );
}
