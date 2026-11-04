import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  customerFileLocation,
  internalFileLocation,
  knownFileProvider,
} from "@/lib/print/file-location";
import { printInvoice } from "@/lib/print/invoice";

const NETWORK_PATH = "\\\\servidor-privado\\clientes\\magerit\\S4C-0020";

describe("file location (PDF)", () => {
  it("internal: the external location wins, then attachments, then nothing", () => {
    assert.equal(internalFileLocation("https://drive.google.com/x", 0), "https://drive.google.com/x");
    assert.equal(internalFileLocation(NETWORK_PATH, 0), NETWORK_PATH);
    assert.equal(internalFileLocation(` ${NETWORK_PATH} `, 3), NETWORK_PATH, "both: external first");
    assert.equal(internalFileLocation(null, 2), "Archivos adjuntos al pedido");
    assert.equal(internalFileLocation("   ", 1), "Archivos adjuntos al pedido");
    assert.equal(internalFileLocation(null, 0), "Sin archivos registrados", "deleted/pending files are not counted");
  });

  it("customer: never the URL, path, host or folder", () => {
    const cases: Array<[string | null, number, string]> = [
      ["https://drive.google.com/drive/folders/1AbCdEf-privado?usp=sharing", 0, "Ubicación externa (Google Drive)"],
      ["https://www.dropbox.com/scl/fo/abc/h?rlkey=secret&dl=0", 0, "Ubicación externa (Dropbox)"],
      ["https://empresa-my.sharepoint.com/personal/x", 0, "Ubicación externa (OneDrive)"],
      ["https://wetransfer.com/downloads/abc", 2, "Ubicación externa (WeTransfer)"],
      ["https://bucket.r2.cloudflarestorage.com/k?X-Amz-Signature=abc", 0, "Ubicación externa registrada"],
      ["https://drive.google.com.evil.example/x", 0, "Ubicación externa registrada"],
      [NETWORK_PATH, 0, "Ubicación externa registrada"],
      ["smb://nas.local/clientes", 1, "Ubicación externa registrada"],
      ["Lo trae el cliente en USB", 0, "Ubicación externa registrada"],
      [null, 4, "Archivos adjuntos al pedido"],
      [null, 0, "Sin archivos registrados"],
    ];
    for (const [external, attached, expected] of cases) {
      const text = customerFileLocation(external, attached);
      assert.equal(text, expected, String(external));
      for (const secret of ["privado", "secret", "servidor", "nas.local", "Signature", "USB", "abc"]) {
        assert.equal(text.includes(secret), false, `${secret} leaked from ${external}`);
      }
    }
  });

  it("knows only public file-sharing hosts", () => {
    assert.equal(knownFileProvider("https://docs.google.com/document/d/x"), "Google Drive");
    assert.equal(knownFileProvider("http://dropbox.com/x"), "Dropbox");
    assert.equal(knownFileProvider("smb://drive.google.com/x"), null);
    assert.equal(knownFileProvider("notdropbox.com/x"), null);
  });
});

describe("invoice states (PDF)", () => {
  it("prints delivery only when an invoice is required", () => {
    assert.deepEqual(printInvoice(null, null), { required: null, delivered: null });
    assert.deepEqual(printInvoice(undefined, true), { required: null, delivered: null });
    assert.deepEqual(printInvoice(false, true), { required: false, delivered: null });
    assert.deepEqual(printInvoice(true, null), { required: true, delivered: null });
    assert.deepEqual(printInvoice(true, false), { required: true, delivered: false });
    assert.deepEqual(printInvoice(true, true), { required: true, delivered: true });
  });
});
