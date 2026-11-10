// Explicit real CLI acceptance, with synthetic text only and an isolated profile.
// No provider switch, private data, tool mutations or real third-party accounts.
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
if (!process.argv.includes('--real')) throw new Error('Pass --real to use the existing configured Codex account.');
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { _electron } = createRequire(requireDesktop.resolve('@playwright/test'))('playwright');
const { expect } = requireDesktop('@playwright/test');
const parent = resolve(process.env.AGENTSTUDIO_MESSENGER_EVIDENCE_DIR || 'output/playwright/messenger-real');
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'real-'));
const env = { ...process.env, AGENTSTUDIO_USER_DATA_DIR: join(output, 'profile'), AGENTSTUDIO_WORKSPACE: 'personal' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'AGENTSTUDIO_CODEX_BIN', 'ELECTRON_RENDERER_URL', 'AGENTSTUDIO_PERSONAL_DATA_DIR', 'PERSONAL_DATA_DIR']) delete env[key];
let app, page;
const checks = [], outcomes = [];
const request = (path, body) => page.evaluate(async ({ path, body }) => {
  const r = await window.agentStudioPersonal.request({ path: `/api${path}`, method: body ? 'POST' : 'GET', ...(body ? { body } : {}) });
  if (r.status >= 400) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}, { path, body });
try {
  const packaged = process.env.AGENTSTUDIO_PACKAGED_APP;
  app = await _electron.launch({ executablePath: packaged ? join(packaged, 'Contents/MacOS/AgentStudio') : requireDesktop('electron'), args: packaged ? [] : [resolve('apps/desktop')], env, timeout: 30000 });
  page = await app.firstWindow();
  await expect(page.getByTestId('im-app')).toBeVisible();
  const discovery = await request('/contacts');
  const codex = discovery.contacts.find(c => c.id === 'agent_codex');
  if (codex?.availability !== 'ready') throw new Error(`Existing Codex unavailable: ${codex?.availability}`);
  const contact = await request('/contacts', { clientId: crypto.randomUUID(), kind: 'agent', name: '验收伙伴', handle: 'acceptance-peer',
    instructions: '你的身份名称是验收伙伴。只用简短中文回答，不读取文件，不调用任何工具，不做外部操作。', binding: { type: 'local', localAgentId: 'codex' } });
  const direct = await request('/chats', { clientId: crypto.randomUUID(), kind: 'direct', memberIds: [contact.id] });
  await page.getByTestId('im-refresh').click();
  await page.getByTestId(`im-chat-${direct.id}`).click();
  await page.getByTestId('im-message-input').fill('这是合成验收。请只回复你当前配置的身份名称，不调用任何工具。');
  await page.getByTestId('im-send').click();
  let completed;
  await expect.poll(async () => {
    completed = await request(`/threads/${direct.id}`);
    return ['completed', 'blocked', 'failed', 'unknown'].includes(completed.runs[0]?.status);
  }, { timeout: 240000, intervals: [1000, 2000] }).toBe(true);
  outcomes.push({ scope: 'direct', status: completed.runs[0].status, error: completed.runs[0].error, executor: completed.runs[0].chosenExecutor });
  expect(completed.runs[0].status, completed.runs[0].error).toBe('completed');
  expect(completed.messages.at(-1).text).toContain('验收伙伴');
  checks.push('real configured Codex replies in the native direct chat as its configured identity');
  const group = await request('/chats', { clientId: crypto.randomUUID(), kind: 'group', title: '真实执行 · 合成验收', memberIds: [contact.id, codex.id] });
  await page.getByTestId('im-refresh').click(); await page.getByTestId(`im-chat-${group.id}`).click();
  await page.getByTestId('im-message-input').fill('@all 这是合成群聊验收，请只回复你当前配置的身份名称，不读取文件，不调用任何工具。');
  await page.getByTestId('im-send').click();
  await expect.poll(async () => {
    completed = await request(`/threads/${group.id}`);
    return completed.runs.length === 2 && completed.runs.every(r => ['completed', 'blocked', 'failed', 'unknown'].includes(r.status));
  }, { timeout: 240000, intervals: [1000, 2000] }).toBe(true);
  for (const run of completed.runs) outcomes.push({ scope: 'group', contact: run.contactSnapshot.name, status: run.status, error: run.error, executor: run.chosenExecutor });
  expect(completed.runs.every(r => r.status === 'completed'), JSON.stringify(outcomes)).toBe(true);
  expect(completed.messages.filter(m => m.role === 'assistant').length).toBe(2);
  expect(completed.messages.some(m => m.contactId === contact.id && m.text.includes('验收伙伴'))).toBe(true);
  expect(completed.messages.some(m => m.contactId === codex.id && /codex/i.test(m.text))).toBe(true);
  checks.push('two group identities execute sequentially through the actual configured backend and keep distinct attribution');
  await page.screenshot({ path: join(output, 'real-group.png') });
  const health = await request('/health');
  await writeFile(join(output, 'runtime.json'), JSON.stringify(health, null, 2));
} finally {
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ realCLI: true, syntheticInputsOnly: true, checks, outcomes, output }, null, 2));
  await app?.close(); console.log(JSON.stringify({ output, checks, outcomes }));
}
