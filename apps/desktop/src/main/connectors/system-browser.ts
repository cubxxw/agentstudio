import { shell } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const launch = promisify(execFile);
/** Normal sign-in only: keep the same URL/account flow if LaunchServices fails. */
export async function openSystemBrowser(url: string, deps: {
  openExternal?: (url: string) => Promise<unknown>;
  fallback?: (url: string) => Promise<unknown>;
  inApp?: (url: string) => Promise<unknown>;
} = {}): Promise<void> {
  try { await (deps.openExternal ?? ((target: string) => shell.openExternal(target)))(url); return; }
  catch { /* The default handler can fail even though Chrome is already open. */ }
  try {
    const fallback = deps.fallback ?? (async (target: string) => {
      if (process.platform !== "darwin" || !/^https?:\/\//.test(target)) throw new Error("No browser fallback");
      await launch("/usr/bin/open", ["-b", "com.google.Chrome", target], { timeout: 15_000 });
    });
    await fallback(url);
  } catch (cause) {
    if (deps.inApp) { await deps.inApp(url); return; }
    throw new Error("The sign-in browser could not be opened", { cause });
  }
}
