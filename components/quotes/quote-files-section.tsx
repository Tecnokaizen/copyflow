"use client";

import { useMemo } from "react";
import { OrderFilesSection } from "@/components/files/order-files-section";
import {
  deleteQuoteFile,
  listQuoteFiles,
  requestQuoteFileDownload,
  uploadQuoteFile,
} from "@/lib/files/client";

export function QuoteFilesSection({
  quoteId,
  onChanged,
}: {
  quoteId: string;
  onChanged?: () => void;
}) {
  const filesApi = useMemo(
    () => ({
      list: listQuoteFiles,
      upload: uploadQuoteFile,
      remove: deleteQuoteFile,
      download: requestQuoteFileDownload,
    }),
    []
  );

  return (
    <OrderFilesSection
      orderId={quoteId}
      canMutate
      archived={false}
      onChanged={onChanged}
      filesApi={filesApi}
      emptyTitle="Este presupuesto no tiene archivos adjuntos."
      emptyDescription="Adjunta el PDF del presupuesto, documentos enviados al cliente o referencias comerciales."
      idleDescription="Documentos asociados al presupuesto"
    />
  );
}
