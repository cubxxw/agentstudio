// Local macOS bundle. No signing account, notarization or publication is used.
import { packager } from "@electron/packager";
import { createReadStream } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Build this local macOS app on a Mac.");
const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
const electronVersion = pkg.devDependencies.electron;
if (!/^\d+\.\d+\.\d+$/.test(electronVersion)) throw new Error("Pin the Electron version before packaging.");
const out = resolve(process.env.AGENTSTUDIO_MAC_OUTPUT || join(directory, "dist"));
const zipDirectory = process.env.ELECTRON_ZIP_DIR;
if (zipDirectory) {
  const name = `electron-v${electronVersion}-darwin-${process.arch}.zip`;
  const checksums = JSON.parse(await readFile(join(dirname(require.resolve("electron/package.json")), "checksums.json"), "utf8"));
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(join(zipDirectory, name))) digest.update(chunk);
  const actual = digest.digest("hex");
  if (actual !== checksums[name]) throw new Error("The local Electron archive does not match its pinned checksum.");
}

// Main and utility code are bundled or use built-in Node modules. A staging
// directory with no node_modules prevents accidentally shipping local profiles.
const main = await readFile(join(directory, "out/main/index.js"), "utf8");
const allowed = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), "electron"]);
for (const match of main.matchAll(/require\(["']([^"']+)["']\)/g)) {
  if (!match[1].startsWith(".") && !allowed.has(match[1])) throw new Error(`Unbundled main dependency: ${match[1]}`);
}
const stage = await mkdtemp(join(tmpdir(), "agentstudio-package-"));
try {
  await mkdir(out, { recursive: true });
  await cp(join(directory, "out"), join(stage, "out"), { recursive: true });
  await writeFile(join(stage, "package.json"), JSON.stringify({
    name: "agentstudio", productName: "AgentRoom", version: pkg.version,
    private: true, main: "out/main/index.js",
  }, null, 2));
  const paths = await packager({
    dir: stage, out, platform: "darwin", arch: process.arch,
    name: "AgentRoom", executableName: "AgentRoom",
    appBundleId: "com.cubxxw.agentstudio", appVersion: pkg.version,
    electronVersion, ...(zipDirectory ? { electronZipDir: zipDirectory } : {}),
    icon: join(directory, "resources/icon.icns"),
    asar: false, prune: false, overwrite: false,
    darwinDarkModeSupport: true,
    // '-' is an ad-hoc identity, not a certificate to discover in Keychain.
    // Ad-hoc signatures have no Team ID. Hardened library validation rejects
    // their Electron framework on macOS; use an explicit local-only profile.
    osxSign: { identity: "-", identityValidation: false, continueOnError: false,
      optionsForFile: () => ({ hardenedRuntime: false, entitlements: ["com.apple.security.cs.allow-jit"],
        additionalArguments: ["--options", "0"] }),
      preAutoEntitlements: false, preEmbedProvisioningProfile: false, gatekeeperAssess: false },
  });
  if (paths.length !== 1) throw new Error("Expected exactly one local application bundle.");
  const bundle = join(paths[0], "AgentRoom.app");
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  const signature = spawnSync("/usr/bin/codesign", ["-dvv", bundle], { encoding: "utf8" });
  const entitlements = spawnSync("/usr/bin/codesign", ["-d", "--entitlements", ":-", bundle], { encoding: "utf8" });
  if (signature.status !== 0 || !/Signature=adhoc/.test(signature.stderr) || /flags=[^\n]*runtime/.test(signature.stderr)
    || entitlements.status !== 0 || !entitlements.stdout.includes("<key>com.apple.security.cs.allow-jit</key>")
    || (entitlements.stdout.match(/<key>/g) || []).length !== 1) throw new Error("The resulting app does not match the local ad-hoc signing profile.");
  const ui = await readFile(join(bundle, "Contents/Resources/app/out/renderer/personal/index.html"));
  const receipt = {
    bundle, electron: electronVersion, arch: process.arch,
    signed: "ad-hoc", hardenedRuntime: false, notarized: false,
    uiEntrySha256: createHash("sha256").update(ui).digest("hex"),
    sourceRef: execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim(),
    dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: directory, encoding: "utf8" }).trim()),
  };
  await writeFile(join(paths[0], "build-receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  await rm(stage, { recursive: true, force: true });
}
