import { ImportFileError, type ImportFileErrorCode } from "./errors";
import type { ParsedImportFile } from "./parse-file";

/**
 * Parses the selected file in a Web Worker; if workers are unavailable it
 * loads the readers on demand and parses on the main thread. Either way the
 * CSV/XLSX libraries stay out of the main bundle and the file is not uploaded.
 */
export async function parseFileInBrowser(file: File, sheet?: string): Promise<ParsedImportFile> {
  const bytes = await file.arrayBuffer();

  if (typeof Worker !== "undefined") {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      const activeWorker = worker;
      return await new Promise<ParsedImportFile>((resolve, reject) => {
        activeWorker.onmessage = (
          event: MessageEvent<{ ok: true; result: ParsedImportFile } | { ok: false; code: ImportFileErrorCode; line?: number }>,
        ) => {
          if (event.data.ok) resolve(event.data.result);
          else reject(new ImportFileError(event.data.code, event.data.line));
        };
        activeWorker.onerror = () => reject(new Error("worker_failed"));
        activeWorker.postMessage({ name: file.name, bytes, sheet });
      });
    } catch (error) {
      if (error instanceof ImportFileError) throw error;
      // Fall back to the main thread below.
    } finally {
      worker?.terminate();
    }
  }

  const { parseImportFile } = await import("./parse-file");
  return parseImportFile({ name: file.name, bytes }, { sheet });
}
