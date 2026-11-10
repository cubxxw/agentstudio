// Explicit real acceptance: existing local CLI accounts and public MCP only.
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
if (!process.argv.includes('--real')) throw new Error('Pass --real to use the configured local CLI accounts and public services.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireDesktop = createRequire(join(root, 'apps/desktop/package.json'));
const { _electron, expect } = requireDesktop('@playwright/test');
const parent = resolve(process.env.AGENTSTUDIO_DESKTOP_EVIDENCE_DIR || join(root, 'output/playwright/connect-native'));
await mkdir(parent, { recursive: true });
const evidence = await mkdtemp(join(parent, 'real-')), profile = join(evidence, 'profile');
const env = { ...process.env, AGENTSTUDIO_USER_DATA_DIR: profile, AGENTSTUDIO_PERSONAL_EXPORT_DIR: join(evidence, 'exports'), AGENTSTUDIO_MOCK_KEYCHAIN: '1' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'AGENTSTUDIO_WORKSPACE', 'AGENTSTUDIO_PERSONAL_DATA_DIR', 'AGENTSTUDIO_CODEX_BIN']) delete env[key];
const checks = [], errors = [], captures = [];
const executionAgent = process.argv.includes('--claude') ? 'claude' : 'codex';
const verify = (value, name) => { if (!value) throw new Error(name); checks.push(name); console.log(`PASS ${name}`); };
let application, page;
const api = (path, body) => page.evaluate(async ({ path, body }) => {
  const response = await window.agentStudioPersonal.request({ path: `/api${path}`, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }) });
  if (response.status >= 300) throw new Error(JSON.stringify(response.body));
  return response.body;
}, { path, body });
const capture = async name => {
  await page.screenshot({ path: join(evidence, `${name}-renderer.png`) });
  const id = await application.evaluate(async ({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; await window.webContents.capturePage(); return window.getMediaSourceId(); });
  execFileSync('/usr/sbin/screencapture', ['-x', '-l', id.split(':')[1], join(evidence, `${name}.png`)]);
  captures.push({ name, method: 'native-window' });
};
const openConnections = async () => {
  await page.getByTestId('personal-desktop-connections').click();
  await page.getByTestId('personal-local-use-claude').waitFor();
};
const send = async text => {
  await page.getByTestId('personal-composer-input').fill(text);
  await page.getByTestId('personal-composer-send').click();
  await page.waitForURL(/thread=thr_/);
  return new URL(page.url()).searchParams.get('thread');
};
const complete = async id => {
  let thread;
  await expect.poll(async () => { thread = await api(`/threads/${id}`); return ['completed', 'failed', 'blocked', 'unknown'].includes(thread.status); }, { timeout: 240000, intervals: [500, 1000] }).toBe(true);
  verify(thread.status === 'completed', `real task completes (${thread.status})`); return thread;
};
try {
  application = await _electron.launch({ executablePath: process.env.AGENTSTUDIO_ELECTRON_BINARY || requireDesktop('electron'), args: [join(root, 'apps/desktop')], env });
  page = await application.firstWindow();
  await page.getByTestId("im-app").waitFor();
  { const legacyUrl = new URL(page.url()); legacyUrl.searchParams.set("workspace", "tasks"); await page.goto(legacyUrl.href); } page.on('pageerror', error => errors.push(error.message));
  await page.getByTestId('personal-desktop-rail').waitFor();
  await openConnections();
  const detected = await api('/integrations');
  verify(detected.agents.filter(agent => ['codex', 'claude'].includes(agent.id)).every(agent => agent.installed && agent.auth.status === 'configured'), 'native discovery finds existing Codex and Claude login configuration');
  verify(detected.agents.some(agent => agent.id === 'pi' && agent.installed && !agent.execution.supported), 'Pi is discovered without falsely claiming supported execution');
  verify(await page.getByTestId('personal-connection-name').count() === 0, 'advanced protocol/name/address fields are absent from the default flow');
  await capture('connections-discovered');
  await page.getByTestId('personal-local-use-claude').click();
  await expect.poll(async () => (await api('/bootstrap')).settings.localAgentId).toBe('claude');
  verify(true, 'one click selects the existing Claude configuration without typing a command');
  await page.keyboard.press('Escape');
  // Choose the execution account explicitly. An unavailable provider never falls
  // through to another CLI; --claude is a separate opt-in acceptance run.
  await openConnections(); await page.getByTestId(`personal-local-use-${executionAgent}`).click();
  await expect.poll(async () => (await api('/bootstrap')).settings.localAgentId).toBe(executionAgent);
  await expect(page.getByTestId(`personal-local-use-${executionAgent}`)).toContainText('正在使用');
  await page.keyboard.press('Escape');
  const localId = await send('合成验收资料：今天有20分钟阅读，准备2分钟、阅读16分钟、记录2分钟。请生成一份简短中文Markdown清单，并写出这三个步骤的总分钟数。不调用工具，不读取文件，不作外部操作。');
  const local = await complete(localId);
  verify(local.runs[0].localAgentId === executionAgent && local.artifacts[0].source === executionAgent, `actual result is produced by the selected ${executionAgent} CLI`);
  await page.getByTestId('personal-open-result').click(); await page.getByTestId('personal-reader').waitFor(); await capture(`${executionAgent}-real-result`); await page.keyboard.press('Escape');
  await openConnections(); await page.getByTestId('personal-local-use-claude').click();
  await expect.poll(async () => (await api('/bootstrap')).settings.localAgentId).toBe('claude');
  verify((await api(`/threads/${localId}`)).runs[0].localAgentId === executionAgent, 'switching defaults never rewrites accepted task executor identity');
  await page.getByTestId('personal-local-use-codex').click();
  await expect.poll(async () => (await api('/bootstrap')).settings.localAgentId).toBe('codex');
  await page.getByTestId('personal-preset-connect-deepwiki').click();
  await expect(page.getByTestId('personal-preset-connect-deepwiki')).toContainText('已连接', { timeout: 45000 });
  await page.getByTestId('personal-preset-connect-exa').click();
  await expect(page.getByTestId('personal-preset-connect-exa')).toContainText('已连接', { timeout: 45000 });
  verify(true, 'DeepWiki and Exa connect with one click and real handshakes, without URL or credential input');
  await capture('connections-linked');
  await page.keyboard.press('Escape'); await page.getByTestId('personal-new').click();
  const mcpId = await send('用已经连接的 DeepWiki 读取 facebook/react 的公开文档目录。不要用 Exa 或其他工具，不修改任何外部数据。');
  await page.getByTestId('personal-decision-approve').waitFor({ timeout: 180000 });
  verify((await api(`/threads/${mcpId}`)).status === 'needs_input', 'a quick-connected tool still waits for the precise execution decision');
  await page.getByTestId('personal-decision-approve').click();
  const mcp = await complete(mcpId);
  verify(mcp.artifacts[0].source === 'mcp' && mcp.runs[0].localAgentId === 'codex', 'selected Codex coordinates the actual public MCP execution');
  await application.close(); application = undefined;
  application = await _electron.launch({ executablePath: process.env.AGENTSTUDIO_ELECTRON_BINARY || requireDesktop('electron'), args: [join(root, 'apps/desktop')], env });
  page = await application.firstWindow();
  await page.getByTestId("im-app").waitFor();
  { const legacyUrl = new URL(page.url()); legacyUrl.searchParams.set("workspace", "tasks"); await page.goto(legacyUrl.href); } await page.getByTestId('personal-desktop-rail').waitFor();
  const restored = await api('/bootstrap');
  verify(restored.settings.localAgentId === 'codex' && restored.connections.length === 2 && [localId, mcpId].every(id => restored.threads.some(thread => thread.id === id && thread.status === 'completed')), 'chosen CLI, quick connections and actual results survive native app restart');
  verify(errors.length === 0, 'connection journeys have no renderer exceptions');
  const result = { profile, checks, errors, captures, detected, local: { id: localId, executionAgent, artifacts: local.artifacts }, mcp: { id: mcpId, artifacts: mcp.artifacts }, inputScope: 'synthetic reading plan and public facebook/react documentation only' };
  await writeFile(join(evidence, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, passed: true }));
} catch (error) {
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ message: error.message, checks, errors, profile }, null, 2));
  throw error;
} finally { await application?.close(); }
