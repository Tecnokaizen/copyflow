"use client";

import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";

type DeleteFileDialogProps = {
  filename: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteFileDialog({
  filename,
  busy = false,
  onConfirm,
  onCancel,
}: DeleteFileDialogProps) {
  return (
    <ConfirmDialog
      title="Eliminar archivo"
      description={`¿Quieres eliminar “${filename}”? Esta acción quitará el archivo del pedido y del almacenamiento.`}
      confirmLabel="Eliminar archivo"
      cancelLabel="Cancelar"
      destructive
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
