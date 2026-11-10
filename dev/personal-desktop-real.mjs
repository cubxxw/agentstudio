// Opt-in acceptance against the real configured CLI and public DeepWiki MCP.
// Only synthetic attachments and public repository data leave the test profile.
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

if (!process.argv.includes("--real")) throw new Error("Use --real to explicitly run the existing CLI and public MCP service.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(process.env.AGENTSTUDIO_DESKTOP_EVIDENCE_DIR || "output/playwright/personal-desktop-real");
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(evidence, "real-profile-"));
const requireDesktop = createRequire(join(root, "apps/desktop/package.json"));
const requireTest = createRequire(requireDesktop.resolve("@playwright/test"));
const { _electron } = requireTest("playwright");
const { expect } = requireDesktop("@playwright/test");
const executable = process.env.AGENTSTUDIO_ELECTRON_BINARY || requireDesktop("electron");
const env = { ...process.env, AGENTSTUDIO_USER_DATA_DIR: profile,
  AGENTSTUDIO_PERSONAL_EXPORT_DIR: join(evidence, "exports"), AGENTSTUDIO_TEST_NOTIFICATIONS: "1" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AGENTSTUDIO_PERSONAL_DATA_DIR;
delete env.AGENTSTUDIO_WORKSPACE;
const checks = [], errors = [];
const verify = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); console.log(`PASS ${name}`); };
let application, page;
const request = (path, body, method) => page.evaluate(async ({ path, body, method }) => {
  const response = await window.agentStudioPersonal.request({ path: `/api${path}`, method: method || (body === undefined ? "GET" : "POST"), ...(body === undefined ? {} : { body }) });
  if (response.status < 200 || response.status >= 300) throw new Error(JSON.stringify(response.body));
  return response.body;
}, { path, body, method });
const waitForCompletion = async id => {
  let thread;
  await expect.poll(async () => {
    thread = await request(`/threads/${id}`);
    return ["completed", "failed", "blocked", "unknown"].includes(thread.status);
  }, { timeout: 240_000, intervals: [250, 500, 1000] }).toBeTruthy();
  verify(thread.status === "completed", `actual task completes: ${id} (${thread.status})`);
  return thread;
};
const begin = async () => {
  application = await _electron.launch({ executablePath: executable, args: [join(root, "apps/desktop")], env, timeout: 30000 });
  page = await application.firstWindow();
  page.on("pageerror", e => errors.push(e.message));
  await page.getByTestId("personal-desktop-rail").waitFor();
  await page.waitForFunction(() => document.body.innerText.includes("工作间在本机运行"));
};
const send = async text => {
  await page.getByTestId("personal-composer-input").fill(text);
  await page.getByTestId("personal-composer-send").click();
  await page.waitForURL(/thread=thr_/);
  return new URL(page.url()).searchParams.get("thread");
};

try {
  await begin();
  const health = await request("/health"), initial = await request("/bootstrap");
  verify(initial.settings.codexAvailable, "existing Codex CLI is available to the native utility");
  await page.getByTestId("personal-attachment-input").setInputFiles([
    { name: "option-a.md", mimeType: "text/markdown", buffer: Buffer.from("# 方案 A\n\n合成验收资料。20分钟：2分钟准备、16分钟阅读、2分钟记录。目标是降低开始负担，不设页数指标。") },
    { name: "option-b.md", mimeType: "text/markdown", buffer: Buffer.from("# 方案 B\n\n合成验收资料。20分钟：8分钟做计划、10分钟阅读、2分钟记录。开始前选择三个阅读指标，便于量化复盘，但增加配置。") },
  ]);
  const cliId = await send("比较两份阅读方案，建议我今晚怎样安排20分钟阅读。给出中文取舍表格、行动清单和附件来源引用。资料为合成验收数据，只基于附件，不调用外部工具。");
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  verify(await application.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible()), "closing the native window hides it");
  const cli = await waitForCompletion(cliId);
  verify(cli.artifacts.length === 1 && cli.artifacts[0].source === "codex", "real CLI result is saved while the window is hidden");
  await application.evaluate(({ app }) => app.emit("activate"));
  await page.getByTestId("personal-open-result").click();
  await page.getByTestId("personal-reader").locator("table").waitFor();
  await page.screenshot({ path: join(evidence, "real-cli-reader.png") });
  const citation = page.getByTestId("personal-reader").locator('a[href^="#source-"]').first();
  await citation.click();
  await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 2);
  verify((await page.getByRole("dialog").last().innerText()).includes("合成验收资料"), "real model citation opens the saved original");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 1);
  await page.getByTestId("personal-reader-download").click();
  await page.getByTestId("personal-save-receipt").waitFor();
  const saved = await readFile(join(evidence, "exports", `${cli.artifacts[0].id}.md`));
  verify(createHash("sha256").update(saved).digest("hex") === cli.artifacts[0].sha256, "native export matches the actual CLI artifact SHA-256");
  await page.keyboard.press("Escape");

  await page.getByTestId("personal-desktop-connections").click();
  await page.getByTestId("personal-add-connection").click();
  await page.getByTestId("personal-connection-name").fill("公开代码文档 · DeepWiki");
  await page.getByTestId("personal-connection-type").selectOption("mcp");
  await page.getByTestId("personal-connection-url").fill("https://mcp.deepwiki.com/mcp");
  await page.getByTestId("personal-connection-save").click();
  await page.waitForFunction(() => document.body.innerText.includes("公开代码文档 · DeepWiki") && !document.querySelector('[data-testid="personal-connection-save"]'));
  const connected = await request("/bootstrap");
  const connection = connected.connections.find(item => item.name === "公开代码文档 · DeepWiki");
  verify(Boolean(connection) && !connection.auth.configured, "real public MCP handshake succeeds without private credentials");
  await page.keyboard.press("Escape");
  await page.getByTestId("personal-new").click();
  const mcpId = await send("用已连接的 DeepWiki 读取 facebook/react 公开文档目录，保留目录与来源。不要使用其他工具，也不要写入任何外部数据。");
  await page.getByTestId("personal-decision-approve").waitFor({ timeout: 180000 });
  const before = await request(`/threads/${mcpId}`);
  verify(before.status === "needs_input" && before.artifacts.length === 0, "actual MCP action waits for the user's precise approval");
  await page.screenshot({ path: join(evidence, "real-mcp-approval.png") });
  await page.getByTestId("personal-decision-approve").click();
  const mcp = await waitForCompletion(mcpId);
  verify(mcp.artifacts.length === 1 && mcp.runs.at(-1).remoteReceipt, "real public MCP result and execution receipt are saved");
  await page.waitForFunction(() => !document.querySelector('[data-testid="personal-open-result"]')?.disabled);
  await page.getByTestId("personal-open-result").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="personal-reader"] .prose')?.textContent.length > 100);
  await page.screenshot({ path: join(evidence, "real-mcp-reader.png") });
  const artifact = await request(`/artifacts/${mcp.artifacts[0].id}`);
  verify(artifact.body.includes("react") || artifact.body.includes("React"), "real returned directory retains repository context");
  const ids = [cliId, mcpId];
  await application.close(); application = undefined;
  await begin();
  const restored = await request("/bootstrap");
  verify(ids.every(id => restored.threads.some(thread => thread.id === id && thread.status === "completed")), "actual CLI and MCP work survives quitting and relaunching the native app");
  verify(errors.length === 0, "native real journeys have no renderer errors");
  const result = { profile, executable, health, checks, errors, cli: { threadId: cliId, artifacts: cli.artifacts }, mcp: { threadId: mcpId, artifacts: mcp.artifacts }, inputScope: "synthetic attachments and public facebook/react documentation only" };
  await writeFile(join(evidence, "real-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, "real-failure.png") }).catch(() => {});
  await writeFile(join(evidence, "real-failure.json"), JSON.stringify({ profile, checks, errors, message: error.message }, null, 2));
  throw error;
} finally {
  await application?.close();
}
