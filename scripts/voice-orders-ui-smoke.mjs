/**
 * Static smoke for Voice Orders AI V1 UI wiring.
 * Does not open a browser; validates source contracts used by the create form.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const form = readFileSync(
  path.join(root, "components/orders/create-order-form.tsx"),
  "utf8"
);
const panel = readFileSync(
  path.join(root, "components/orders/voice/voice-order-panel.tsx"),
  "utf8"
);
const createForm = readFileSync(
  path.join(root, "lib/orders/create-form.ts"),
  "utf8"
);

const checks = [
  [form.includes('VoiceOrderPanel'), "CreateOrderForm mounts VoiceOrderPanel"],
  [form.includes("buildCreateOrderPayload"), "CreateOrderForm still uses buildCreateOrderPayload"],
  [form.includes('markTouched'), "CreateOrderForm tracks touched fields"],
  [panel.includes("/api/ai/voice-orders/transcriptions"), "Panel posts transcriptions"],
  [panel.includes("/api/ai/voice-orders/drafts"), "Panel posts drafts"],
  [!panel.includes("/api/orders"), "Panel does not create orders"],
  [createForm.includes("buildCreateOrderPayload"), "create-form contract unchanged"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) {
    console.log(`ok - ${label}`);
  } else {
    console.error(`fail - ${label}`);
    failed += 1;
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log("voice-orders-ui-smoke: ok");
