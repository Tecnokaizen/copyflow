import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOrderUploadQueue } from "./create-order-queue";
import { MAX_ORDER_FILE_BYTES, type ClientUploadItem } from "./client";

const pdf = (name = "artwork.pdf") => new File(["%PDF-1.7"], name, { type: "application/pdf" });
const max = MAX_ORDER_FILE_BYTES;

describe("order creation file queue", () => {
  it("keeps files local until an order exists, then binds every upload to it", async () => {
    const calls: string[] = [];
    let state: ClientUploadItem[] = [];
    const queue = createOrderUploadQueue((next) => { state = next; }, {
      upload: async (orderId, file) => { calls.push(orderId); return { fileId: file.name }; },
      complete: async () => {},
    });
    queue.add([pdf(), pdf("other.pdf")], max);
    assert.equal(state.length, 2);
    assert.deepEqual(calls, []);
    await assert.rejects(queue.upload("", max));
    assert.equal(await queue.upload("order-a", max), true);
    assert.deepEqual(calls, ["order-a", "order-a"]);
    assert.ok(state.every((item) => item.phase === "success"));
    await assert.rejects(queue.upload("order-b", max), /otro pedido/);
    queue.clear();
    queue.add([pdf()], max);
    assert.equal(await queue.upload("order-b", max), true);
  });

  it("bounds concurrency, ignores duplicate submissions and protects active items", async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    const queue = createOrderUploadQueue(() => {}, {
      upload: async () => {
        active++; calls++; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { fileId: String(calls) };
      },
      complete: async () => {},
    });
    queue.add([pdf(), pdf(), pdf(), pdf()], max);
    const first = queue.upload("order-a", max);
    assert.equal(queue.upload("order-a", max), first);
    queue.clear();
    queue.remove(queue.snapshot()[0].localId);
    queue.add([pdf()], max);
    assert.equal(await first, true);
    assert.equal(peak, 2);
    assert.equal(calls, 4);
    assert.equal(queue.snapshot().length, 4);
  });

  it("retries only failures on the saved order; completed files are never sent twice", async () => {
    const names: string[] = [];
    let failed = false;
    const queue = createOrderUploadQueue(() => {}, {
      upload: async (id, file) => {
        assert.equal(id, "saved-order");
        names.push(file.name);
        if (file.name === "retry.pdf" && !failed) {
          failed = true;
          throw Object.assign(new Error("Offline"), { kind: "put" });
        }
        return { fileId: file.name };
      },
      complete: async () => {},
    });
    queue.add([pdf("ok.pdf"), pdf("retry.pdf")], max);
    assert.equal(await queue.upload("saved-order", max), false);
    assert.equal(await queue.upload("saved-order", max), true);
    assert.deepEqual(names, ["ok.pdf", "retry.pdf", "retry.pdf"]);
  });

  it("retries COMPLETE with the same file ID, even after another failed confirmation", async () => {
    let uploads = 0;
    let completions = 0;
    const queue = createOrderUploadQueue(() => {}, {
      upload: async () => {
        uploads++;
        throw Object.assign(new Error("Lost response"), { kind: "complete", fileId: "existing-file" });
      },
      complete: async (orderId, fileId) => {
        assert.equal(orderId, "saved-order");
        assert.equal(fileId, "existing-file");
        if (++completions === 1) throw new Error("Offline");
      },
    });
    queue.add([pdf()], max);
    assert.equal(await queue.upload("saved-order", max), false);
    assert.equal(await queue.upload("saved-order", max), false);
    assert.equal(await queue.upload("saved-order", max), true);
    assert.equal(uploads, 1);
    assert.equal(completions, 2);
  });

  it("validates tenant size limits before saving and allows removing invalid files", () => {
    const queue = createOrderUploadQueue(() => {});
    queue.add([pdf()], 1);
    const item = queue.snapshot()[0];
    assert.equal(item.errorKind, "client");
    queue.remove(item.localId);
    assert.deepEqual(queue.snapshot(), []);
  });
});
