// End-to-end test: real frontend + real bot over SmallWebRTC, with a fake
// microphone that plays synthesized Japanese candidate answers.
//
//   (bot on :7860, client on :3000 must be running)
//   node scripts/e2e.mjs [seconds=100] [label]
//
// Writes e2e-output/<label>.png (screenshot) and <label>.json (timeline).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const wav = resolve(here, "../../server/test_audio/candidate.wav");
const outDir = resolve(here, "../e2e-output");
const seconds = Number(process.argv[2] ?? 100);
const label = process.argv[3] ?? "e2e";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  permissions: ["microphone"],
  acceptDownloads: true,
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text());
});

await page.goto("http://localhost:3000");
await page.getByRole("button", { name: "Connect" }).click();
console.log(`Connected; running for ${seconds}s…`);

for (let s = 10; s <= seconds; s += 10) {
  await page.waitForTimeout(10_000);
  const n = await page.locator("text=/messages$/").first().textContent().catch(() => "?");
  console.log(`  t=${s}s ${n}`);
}

// Zoom the timeline out so the whole session fits, then capture.
for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom out" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/${label}.png` });
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "Download" }).click(),
]);
await download.saveAs(`${outDir}/${label}.json`);

// Chat transcript as shown in the UI.
const bubbles = await page.locator("section[aria-label=Conversation] p").allTextContents();
writeFileSync(`${outDir}/${label}.txt`, bubbles.join("\n"));
console.log("\n--- chat ---\n" + bubbles.join("\n"));

await page.getByRole("button", { name: /Disconnect/ }).click().catch(() => {});
await browser.close();
console.log(`\nSaved ${outDir}/${label}.{png,json,txt}`);
