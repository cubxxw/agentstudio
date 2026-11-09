import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL(".", import.meta.url));
const children = [
  spawn(process.execPath, ["--watch", "server/index.mjs"], {
    cwd,
    stdio: "inherit",
  }),
  spawn("pnpm", ["exec", "vite"], { cwd, stdio: "inherit" }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => close());
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    close(1);
  });
  child.on("exit", (code) => close(code ?? 1));
}
