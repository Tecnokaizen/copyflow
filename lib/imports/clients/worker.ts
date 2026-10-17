// Web Worker: reads the client export off the main thread. The file never
// leaves the browser; only parsed text rows are posted back.
import { ImportFileError } from "./errors";
import { parseImportFile } from "./parse-file";

type ParseRequest = { name: string; bytes: ArrayBuffer; sheet?: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = async (event) => {
  const { name, bytes, sheet } = event.data;
  try {
    const result = await parseImportFile({ name, bytes }, { sheet });
    scope.postMessage({ ok: true, result });
  } catch (error) {
    scope.postMessage({
      ok: false,
      code: error instanceof ImportFileError ? error.code : "invalid_xlsx",
      line: error instanceof ImportFileError ? error.line : undefined,
    });
  }
};
