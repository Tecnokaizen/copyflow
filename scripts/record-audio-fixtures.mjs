// Records the MediaRecorder fixtures of lib/ai/voice-orders/__fixtures__/audio
// in Chromium, Firefox and WebKit. A 440 Hz WebAudio tone, never a
// microphone: the files carry no voice.
//
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.js \
//     node scripts/record-audio-fixtures.mjs <out-dir> [seconds]
//
// Needs the three Playwright browsers (`npx playwright install chromium
// firefox webkit`). Prints each file with its size.
import { writeFileSync } from "node:fs";
import path from "node:path";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("PLAYWRIGHT_MODULE is required");
  process.exit(1);
}
const playwright = (await import(modulePath)).default;
const [outDir, secondsArg = "3"] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/record-audio-fixtures.mjs <out-dir> [seconds]");
  process.exit(1);
}
const milliseconds = Number(secondsArg) * 1000;

// What the app's recorder picks first, plus the formats it must reject.
const RECORDINGS = {
  chromium: [
    ["audio/webm;codecs=opus", ".webm"],
    ["audio/mp4;codecs=opus", "-opus.mp4"],
  ],
  firefox: [
    ["audio/webm;codecs=opus", ".webm"],
    ["audio/ogg;codecs=opus", ".ogg"],
  ],
  webkit: [
    ["audio/webm;codecs=opus", ".webm"],
    ["audio/mp4", "-aac.mp4"],
  ],
};

for (const [engine, recordings] of Object.entries(RECORDINGS)) {
  const browser = await playwright[engine].launch();
  const page = await browser.newPage();
  // A secure-context origin served from memory.
  await page.route("https://fixtures.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<button id=go>go</button>" })
  );
  await page.goto("https://fixtures.test/");
  const version = browser.version().split(".")[0];

  for (const [mimeType, suffix] of recordings) {
    await page.evaluate(() => {
      window.__go = new Promise((resolve) =>
        document.getElementById("go").addEventListener("click", resolve, { once: true })
      );
    });
    // A user gesture lets WebKit start the AudioContext.
    await page.click("#go");
    const base64 = await page.evaluate(
      async ({ mimeType, milliseconds }) => {
        await window.__go;
        const context = new AudioContext();
        await context.resume();
        const oscillator = context.createOscillator();
        oscillator.frequency.value = 440;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        const recorder = new MediaRecorder(destination.stream, {
          mimeType,
          audioBitsPerSecond: 48_000,
        });
        const chunks = [];
        recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
        const stopped = new Promise((resolve) => (recorder.onstop = resolve));
        recorder.start();
        await new Promise((resolve) => setTimeout(resolve, milliseconds));
        recorder.stop();
        await stopped;
        oscillator.stop();
        await context.close();
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      },
      { mimeType, milliseconds }
    );
    const file = path.join(outDir, `${engine}-${version}-${secondsArg}s${suffix}`);
    const bytes = Buffer.from(base64, "base64");
    writeFileSync(file, bytes);
    console.log(file, bytes.length);
  }
  await browser.close();
}
