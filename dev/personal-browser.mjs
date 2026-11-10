import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Reuse the repository's existing Playwright installation; no product dependency.
const requireDesktop = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const requireTest = createRequire(requireDesktop.resolve("@playwright/test"));
const { chromium } = requireTest("playwright");
const { expect } = requireDesktop("@playwright/test");
const until = (probe, timeout = 30000) =>
  expect.poll(probe, { timeout, intervals: [100, 200, 500] }).toBeTruthy();
const evidenceDir = resolve("output/playwright/personal");
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "darwin" ? { channel: "chrome" } : {}),
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(error.message));
await context.tracing.start({ screenshots: true, snapshots: true });
let timeout;
try {
  const script =
    process.argv[2] === "edges"
      ? "personal-browser-edge-checks.js"
      : "personal-browser-checks.js";
  const source = (await readFile(new URL(script, import.meta.url), "utf8"))
    .trim()
    .replace(/;$/, "");
  const checks = new Function(`return (${source})`)();
  const result = await Promise.race([
    checks(page, until),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Browser acceptance exceeded 120 seconds")),
        120_000,
      );
    }),
  ]);
  if (consoleErrors.length)
    throw new Error(`Browser errors: ${consoleErrors.join("; ")}`);
  await writeFile(
    resolve(
      evidenceDir,
      process.argv[2] === "edges" ? "edge-checks.json" : "checks.json",
    ),
    JSON.stringify({ ...result, consoleErrors }, null, 2),
  );
  console.log(JSON.stringify({ ...result, consoleErrors }, null, 2));
} catch (error) {
  await page
    .screenshot({ path: resolve(evidenceDir, "failure.png") })
    .catch(() => {});
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await context.tracing
    .stop({
      path: resolve(
        evidenceDir,
        process.argv[2] === "edges" ? "trace-edges.zip" : "trace.zip",
      ),
    })
    .catch(() => {});
  await browser.close();
}
