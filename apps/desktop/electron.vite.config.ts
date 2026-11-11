import { resolve } from "node:path";
import { copyFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import pkg from "./package.json";

let sourceRevision = "unknown-source";
try {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: __dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
  if (/^[a-f0-9]{40}$/.test(head)) sourceRevision = `${head}${dirty ? "-dirty" : ""}`;
} catch { /* Source archives without Git cannot claim a verified revision. */ }

// Main and preload are emitted as CommonJS (the package is not "type": "module"),
// which the sandboxed preload requires. The renderer is bundled locally and
// loaded with loadFile in production; it never loads remote code.
export default defineConfig({
  main: {
    // Also correct when Electron is started on the bundle file directly.
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_REVISION__: JSON.stringify(sourceRevision) },
    plugins: [{
      name: "agentstudio-personal-runtime",
      buildStart() {
        for (const file of ["index.mjs", "runtime.mjs", "store.mjs", "vault.mjs", "local-agents.mjs", "integrations.mjs", "messenger.mjs", "agent-profiles.mjs", "agent-onboarding.mjs", "agent-scheduler.mjs", "host-discovery.mjs", "provider-approvals.mjs"]) this.addWatchFile(resolve(__dirname, "../personal/server", file));
        this.addWatchFile(resolve(__dirname, "src/main/worker.mjs"));
      },
      writeBundle() {
        const output = resolve(__dirname, "out/main/personal");
        mkdirSync(output, { recursive: true });
        for (const file of ["index.mjs", "runtime.mjs", "store.mjs", "vault.mjs", "local-agents.mjs", "integrations.mjs", "messenger.mjs", "agent-profiles.mjs", "agent-onboarding.mjs", "agent-scheduler.mjs", "host-discovery.mjs", "provider-approvals.mjs"]) copyFileSync(resolve(__dirname, "../personal/server", file), resolve(output, file));
        copyFileSync(resolve(__dirname, "src/main/worker.mjs"), resolve(output, "worker.mjs"));
      },
    }],
    // Brand images are imported with ?asset and copied into out/; don't leave them as a runtime require.
    build: { externalizeDeps: { exclude: ["@agentstudio/brand"] } },
  },
  preload: {
    build: { rollupOptions: { input: {
      index: resolve(__dirname, "src/preload/index.ts"),
      personal: resolve(__dirname, "src/preload/personal.ts"),
    } } },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    // Dev server stays on loopback like the rest of the local stack.
    server: { host: "127.0.0.1" },
    build: {
      rollupOptions: { input: {
        legacy: resolve(__dirname, "src/renderer/index.html"),
        personal: resolve(__dirname, "src/renderer/personal/index.html"),
      } },
    },
  },
});
