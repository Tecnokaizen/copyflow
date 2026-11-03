import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseInitialFinance, pendingInitialFinanceLabel, persistInitialFinance,
} from "./initial-finance";

describe("finance while creating a new order", () => {
  it("accepts optional amounts and calculates pending without floating-point rounding", () => {
    assert.deepEqual(parseInitialFinance({ totalAmount: "", advanceAmount: "" }), {
      ok: true, totalAmount: null, advanceAmount: null, pendingAmount: null,
    });
    assert.deepEqual(parseInitialFinance({ totalAmount: "85,00", advanceAmount: "30" }), {
      ok: true, totalAmount: "85.00", advanceAmount: "30.00", pendingAmount: "55.00",
    });
    assert.equal(pendingInitialFinanceLabel(parseInitialFinance({ totalAmount: "0,30", advanceAmount: "0,20" })), "0,10 €");
    assert.deepEqual(parseInitialFinance({ totalAmount: "85", advanceAmount: "" }), {
      ok: true, totalAmount: "85.00", advanceAmount: null, pendingAmount: "85.00",
    });
  });

  it("rejects invalid money before creating an order", () => {
    for (const [totalAmount, advanceAmount] of [
      ["", "10"], ["100", "120"], ["-1", ""],
      ["100", "-5"], ["100", "1.999"], ["5abc", ""],
    ]) {
      assert.equal(parseInitialFinance({ totalAmount, advanceAmount }).ok, false);
    }
  });

  it("records total first then a single idempotent advance, preserving key on retries", async () => {
    const finance = parseInitialFinance({ totalAmount: "85", advanceAmount: "30" });
    assert.equal(finance.ok, true);
    if (!finance.ok) return;
    const calls: Array<{ method: string; url: string; data: Record<string, string> | null }> = [];
    let totalAmount: string | null = null;
    let paymentRecorded = false;
    let rejectOnce = true;
    const mockedFetch = (async (url: string, options?: RequestInit) => {
      if (url === "/api/context") return Response.json({tenant:{id:"tenant-a",slug:"demo"},user:{id:"user-a"}});
      const method = options?.method ?? "GET";
      const data = options?.body ? JSON.parse(String(options.body)) as Record<string, string> : null;
      calls.push({ url, method, data });
      if (method === "PATCH") totalAmount = data?.total_amount ?? null;
      if (method === "POST") {
        paymentRecorded = true;
        if (rejectOnce) { rejectOnce = false; throw Error("connection interrupted"); }
      }
      return new Response(JSON.stringify({
        total_amount: totalAmount, row_version: method === "GET" ? (totalAmount ? "2" : "1") : "2",
        paid_amount: paymentRecorded ? "30.00" : "0.00", pending_amount: "55.00",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const args = {
      orderId: "order-1", finance, idempotencyKey: "fixed-key-1234",
      paidAt: "2026-10-09T12:00:00.000Z", paymentMethod: "cash" as const, request: mockedFetch,
    };
    await assert.rejects(persistInitialFinance(args), /connection interrupted/);
    await persistInitialFinance(args);
    assert.equal(calls.filter(call => call.method === "PATCH").length, 1);
    const posts = calls.filter(call => call.method === "POST");
    assert.equal(posts.length, 2);
    assert.equal(posts[0].data?.idempotency_key, posts[1].data?.idempotency_key);
    assert.equal(posts[0].data?.amount, "30.00");
  });

  it("keeps uncertain payment requests recoverable in the existing scoped storage", async () => {
    const finance = parseInitialFinance({totalAmount:"85", advanceAmount:"30"});
    if (!finance.ok) throw Error("invalid fixture");
    const stored = new Map<string,string>();
    const storage = {getItem:(key:string)=>stored.get(key) ?? null, setItem:(key:string,value:string)=>{stored.set(key,value);}, removeItem:(key:string)=>{stored.delete(key);}};
    let fail = true;
    let posts = 0;
    const request = (async (url:string, init?:RequestInit) => {
      if (url === "/api/context") return Response.json({tenant:{id:"ta",slug:"demo"},user:{id:"ua"}});
      if (init?.method === "POST") {
        posts++;
        assert.equal(stored.size, 1, "save retry key BEFORE sending payment");
        if (fail) throw Error("response lost");
      }
      return Response.json({total_amount:"85.00",row_version:"2"});
    }) as typeof fetch;
    const input = {orderId:"oa",finance,idempotencyKey:"recover-key",paidAt:"2026-11-03T10:00:00Z",paymentMethod:"bizum" as const,storage,request,expectedTenantSlug:"demo",expectedUserId:"ua"};
    await assert.rejects(persistInitialFinance(input), /response lost/);
    const pending = JSON.parse(stored.get("gestcopy.payment-pending.v2:ta:ua:oa")!);
    assert.equal(pending.payment_method, "bizum");
    assert.equal(pending.amount, "30.00");
    fail = false;
    await persistInitialFinance(input);
    assert.equal(posts, 2);
    assert.equal(stored.size, 0);
  });

  it("refuses a changed session, missing method, or concurrent total without sending a payment", async () => {
    const finance = parseInitialFinance({totalAmount:"85", advanceAmount:"30"});
    if (!finance.ok) throw Error("invalid fixture");
    for (const scenario of ["session", "method", "total", "storage"]) {
      let writes = 0;
      const request = (async (url:string, init?:RequestInit) => {
        if (url === "/api/context") return Response.json({tenant:{id:"ta",slug:"demo"},user:{id:"ua"}});
        if (init?.method) writes++;
        return Response.json({total_amount:scenario === "total" ? "90.00" : "85.00",row_version:"2"});
      }) as typeof fetch;
      await assert.rejects(persistInitialFinance({orderId:"oa",finance,idempotencyKey:"test-key",paidAt:"2026-11-03T10:00:00Z",
        paymentMethod:scenario === "method" ? "" : "cash", expectedTenantSlug:scenario === "session" ? "other" : "demo", request,
        storage:scenario === "storage" ? {getItem:()=>null,setItem:()=>{throw Error("blocked storage");},removeItem:()=>{}} : undefined,
      }));
      assert.equal(writes, 0, scenario);
    }
  });

  it("never creates a payment from an omitted or zero advance", async () => {
    for (const advanceAmount of ["", "0", "0,00"]) {
      const finance = parseInitialFinance({totalAmount:"85",advanceAmount});
      if (!finance.ok) throw Error("invalid fixture");
      const methods:string[] = [];
      await persistInitialFinance({orderId:"oa",finance,idempotencyKey:"unused",paidAt:"",request:(async (url:string, init?:RequestInit)=>{
        if (url === "/api/context") return Response.json({tenant:{id:"ta",slug:"demo"},user:{id:"ua"}});
        methods.push(init?.method ?? "GET");
        return Response.json({total_amount:"85.00",row_version:"2"});
      }) as typeof fetch});
      assert.deepEqual(methods,["GET"]);
    }
  });

  it("does not contact collection endpoints when no total was given", async () => {
    const finance = parseInitialFinance({ totalAmount: "", advanceAmount: "" });
    assert.equal(finance.ok, true);
    if (!finance.ok) return;
    await persistInitialFinance({
      orderId: "order-1", finance, idempotencyKey: "not-used", paidAt: "",
      request: (async () => { throw Error("Unexpected request"); }) as typeof fetch,
    });
  });
});
