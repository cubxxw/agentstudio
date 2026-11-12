// Isolated Electron UI checks. Synthetic records only; never calls a provider.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanDesktopTestEnv, launchDesktopTest } from './desktop-test-env.mjs';
import { PersonalStore } from '../apps/personal/server/store.mjs';
import { ArtifactStore } from '../apps/personal/server/artifact-store.mjs';

const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { _electron, expect } = requireDesktop('@playwright/test');
const baseline = process.argv.includes('--baseline');
const output = await mkdtemp(join(process.env.AGENTROOM_CRAFT_EVIDENCE_DIR || '/tmp', baseline ? 'craft-before-' : 'craft-after-'));
const cli = join(output, 'synthetic-codex');
const codexHome = join(output, 'codex-home');
await mkdir(codexHome);
await writeFile(join(codexHome, 'config.toml'), 'model = "synthetic-model"\nmodel_reasoning_effort = "high"\n');
await writeFile(cli, `#!${process.execPath}
if(process.argv.includes('--version')){console.log('codex 0.0.1-synthetic');process.exit(0)}
if(process.argv.includes('login')){console.error('Logged in');process.exit(0)}
process.exit(1);
`, { mode: 0o700 });
const env = { ...process.env, CODEX_HOME: codexHome, AGENTSTUDIO_WORKSPACE: 'personal', AGENTSTUDIO_USER_DATA_DIR: join(output, 'profile'), AGENTSTUDIO_CODEX_BIN: cli, AGENTSTUDIO_CLAUDE_BIN: join(output, 'missing'), AGENTSTUDIO_PI_BIN: join(output, 'missing'), AGENTSTUDIO_MOCK_KEYCHAIN: '1' };
cleanDesktopTestEnv(env);
for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'AGENTSTUDIO_PERSONAL_DATA_DIR', 'PERSONAL_DATA_DIR']) delete env[name];
let app = await launchDesktopTest(_electron, { executablePath: requireDesktop('electron'), args: [resolve('apps/desktop')], env });
let page = await app.firstWindow();
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const request = (path, body) => page.evaluate(async ({ path, body }) => {
  const reply = await window.agentStudioPersonal.request({ path: `/api${path}`, method: body ? 'POST' : 'GET', ...(body ? { body } : {}) });
  if (reply.status >= 400) throw new Error(`Synthetic API ${path}: ${reply.status} ${JSON.stringify(reply.body)}`);
  return reply.body;
}, { path, body });
const shot = async name => {
  await page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' });
  if (process.platform === 'darwin' && process.env.AGENTROOM_AUTOMATION_VISIBLE === '1') {
    const source = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); return win.getMediaSourceId(); });
    try { execFileSync('/usr/sbin/screencapture', ['-x', '-l', source.split(':')[1], join(output, `${name}-macos.png`)], { timeout: 10000, stdio: 'pipe' }); } catch { /* Renderer capture stays available; OS material is not claimed. */ }
  }
};
const check = label => { checks.push(label); console.log(`PASS ${label}`); };
const bounds = (width, height) => app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setBounds(size); }, { width, height });
try {
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await page.emulateMedia({ colorScheme: 'light' });
  await bounds(1200, 780);
  await expect(page.getByTestId('im-app')).toBeVisible();
  await request('/workspace/onboarding', { action: 'complete', name: '合成验收', clientId: 'craft-owner' });
  await request('/contacts/local', { agentIds: ['codex'], clientId: 'craft-adopt' });
  const contacts = [];
  for (let i = 0; i < 14; i++) contacts.push(await request('/contacts', { kind: 'agent', name: i ? `研究伙伴 ${String(i).padStart(2, '0')}` : '产品设计伙伴', handle: i ? `craft_${i}` : 'w'.repeat(32), description: i ? '一起查证资料，整理清晰的结论。' : '从日常使用出发，一起打磨细节。', color: 'teal', binding: { type: 'local', localAgentId: 'codex' }, clientId: `craft-contact-${i}` }));
  const local = await request('/threads', { text: '合成资料：比较两种设计方案\n\n方案 A：紧凑信息，适合快速浏览。\n方案 B：舒适阅读，适合深入讨论。', mode: 'local', clientId: 'craft-local' });
  await expect.poll(async () => (await request(`/threads/${local.id}`)).status).toBe('completed');
  await page.reload();
  await page.getByTestId('im-nav-contacts').click();
  await page.getByTestId(`im-contact-${contacts[0].id}`).click();
  await expect(page.getByTestId('im-agent-card')).toContainText('synthetic-model');
  await shot('01-contact-light');
  if (!baseline) {
    const model = await page.getByTestId('im-agent-card-model').boundingBox();
    expect(model.y + model.height).toBeLessThan(650);
    const rows = await page.getByTestId(`im-contact-${contacts[0].id}`).boundingBox();
    expect(rows.height).toBeLessThanOrEqual(70);
    check('contact model and key facts fit in the first screen; list rows stay compact');
    await page.getByTestId('im-list-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.getByTestId('im-nav-chats').click();
    expect(await page.getByTestId('im-list-scroll').evaluate(node => node.scrollTop)).toBe(0);
    check('switching sections starts the new list at the top');
  }
  await page.getByTestId('im-nav-chats').click();
  await page.getByTestId(`im-chat-${local.id}`).click();
  await page.getByTestId('im-message-input').fill('合成草稿：回来后继续。');
  await shot('02-chat-light');
  if (!baseline) {
    const direct = await request('/chats', { kind: 'direct', memberIds: [contacts[0].id], clientId: 'craft-library-context' });
    await page.getByTestId('im-refresh').click();
    await page.getByTestId(`im-chat-${direct.id}`).click();
    await page.getByTestId('im-nav-library').click();
    await expect(page.getByTestId('library-empty')).toContainText('还没有作品');
    await expect(page.getByTestId('library-welcome')).toContainText('一起做的作品');
    await shot('02b-library-empty');
    await page.getByTestId('library-start-group').click();
    await expect(page.getByTestId('im-group-editor')).toBeVisible();
    await expect(page.getByTestId(`im-member-${contacts[0].id}`)).not.toBeChecked();
    await page.keyboard.press('Escape');
    await page.getByTestId('im-search').fill('没有这件作品');
    await expect(page.getByTestId('library-empty')).toContainText('没有找到匹配的作品');
    await expect(page.getByTestId('library-start-group')).toHaveCount(0);
    await shot('02c-library-no-results');
    await page.getByTestId('library-clear-search').click();
    await expect(page.getByTestId('im-search')).toHaveValue('');
    await expect(page.getByTestId('im-search')).toBeFocused();
    await page.getByTestId('im-nav-chats').click();
    await page.getByTestId(`im-chat-${local.id}`).click();
    check('library distinguishes empty from no results and creates groups without inheriting a previous private contact');
  }
  // Replace only this isolated application's service enumeration; no provider/account is used.
  if (!baseline) await app.evaluate(({ ipcMain }) => {
    let instances = [
      { id: 'craft-one', service: 'grokbot', name: '合成设计伙伴', status: 'ready', connectionId: 'synthetic-one', canOpen: true },
      { id: 'craft-two', service: 'grokbot', name: '这是一条很长的合成助手名称，用来检查连接管理中的换行和操作空间。'.repeat(3), status: 'ready', connectionId: 'synthetic-two', canOpen: true },
      { id: 'craft-three', service: 'grokbot', name: '合成待登录伙伴', status: 'needs_login', canOpen: false },
    ];
    ipcMain.removeHandler('agentstudio:personal:integration');
    ipcMain.handle('agentstudio:personal:integration', (_event, request) => {
      if (request.kind === 'services') return { state: 'catalog', instances };
      if (request.kind === 'remove') { instances = instances.filter(item => item.id !== request.instanceId); return { state: 'ready' }; }
      return { state: 'failed', message: 'Synthetic fixture supports enumeration and removal only' };
    });
  });
  await page.getByTestId('im-settings').click();
  await expect(page.getByTestId('personal-connections')).toBeVisible();
  if (!baseline) await expect(page.getByTestId('personal-local-use-codex')).toHaveCSS('opacity', '1');
  await shot('03-settings-light');
  if (!baseline) {
    const group = page.getByTestId('personal-service-instances-toggle-grokbot');
    await expect(group).toContainText('3 个助手');
    await expect(group).toContainText('1 个需要检查');
    await page.getByTestId('personal-jump-agents').click();
    await group.click();
    await expect(page.getByTestId('personal-service-instance').last()).toBeVisible();
    await shot('03b-settings-instances');
    await page.getByTestId('personal-service-remove-craft-one').click();
    await expect(group).toHaveCount(0);
    await expect(page.getByTestId('personal-service-instance')).toHaveCount(2);
    await expect(page.getByTestId('personal-service-instance').last()).toBeVisible();
    check('large connection groups disclose counts and warnings; remaining rows stay reachable after removal');
    await page.getByTestId('personal-jump-tools').click();
    await expect(page.getByTestId('personal-own-service')).toBeInViewport();
    await expect(page.getByTestId('personal-connections-heading-tools')).toBeFocused();
    await page.getByTestId('personal-tab-connections').focus();
    await page.getByTestId('personal-tab-connections').press('ArrowDown');
    await expect(page.getByTestId('personal-tab-im')).toBeFocused();
    await expect(page.getByTestId('im-preferences')).toBeVisible();
    await page.getByTestId('personal-tab-im').press('End');
    await expect(page.getByTestId('personal-tab-testing')).toBeFocused();
    await expect(page.getByTestId('workspace-tools')).toBeVisible();
    await page.getByTestId('personal-tab-testing').press('Home');
    await expect(page.getByTestId('personal-tab-connections')).toBeFocused();
    check('settings category keys and connection jump navigation move focus to the right content');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('im-message-input')).toHaveValue('合成草稿：回来后继续。');
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
  expect(await page.getByTestId('im-app').evaluate(node => getComputedStyle(node).getPropertyValue('--im-paper').trim())).toBe('#262e36');
  await page.getByTestId('im-nav-contacts').click();
  await page.getByTestId(`im-contact-${contacts[0].id}`).click();
  await shot('04-contact-dark');
  await page.getByTestId('im-settings').click();
  await expect(page.getByTestId('personal-connections')).toBeVisible();
  await shot('05-settings-dark');
  await page.keyboard.press('Escape');
  await bounds(780, 640);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await page.getByTestId('im-back').click();
  await page.getByTestId('im-settings').click();
  await expect(page.getByTestId('personal-connections')).toBeVisible();
  await shot('06-settings-zoom');
  expect(await page.getByTestId('personal-modal').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  if (!baseline) {
    await page.getByTestId('personal-tab-testing').click();
    await expect(page.getByTestId('workspace-tools')).toBeVisible();
    check('200 percent zoom keeps settings categories and content reachable');
  }
  await page.keyboard.press('Escape');
  if (!baseline) {
    await bounds(640, 780);
    expect(await page.evaluate(() => innerWidth)).toBe(320);
    await page.getByTestId('im-settings').click();
    await page.getByTestId('personal-jump-tools').click();
    const jumpBottom = await page.getByTestId('personal-jump-tools').evaluate(node => node.closest('nav').getBoundingClientRect().bottom);
    const target = await page.getByTestId('personal-connections-heading-tools').boundingBox();
    expect(target.y).toBeGreaterThanOrEqual(jumpBottom);
    await expect(page.getByTestId('personal-modal-close')).toBeInViewport();
    await shot('06b-settings-320');
    await page.keyboard.press('Escape');
    check('wrapped connection shortcuts at 320 CSS pixels keep their target heading visible');
  }
  await page.getByTestId(`im-contact-${contacts[0].id}`).click();
  await shot('07-contact-narrow');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByTestId('im-contact-detail').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce', contrast: 'more' });
  await shot('08-contact-accessibility');
  expect(errors).toEqual([]);
  check('light, dark, narrow, stronger contrast and reduced motion render without exceptions');
  if (!baseline) {
    // Seed a committed synthetic document only after this app has released its worker lock.
    await app.close();
    const store = new PersonalStore(join(output, 'profile', 'personal'));
    let artifactId;
    try {
      const artifacts = new ArtifactStore(store, { authorize: context => { if (!context.synthetic) throw new Error('Synthetic fixture only'); } });
      const actor = { contactId: 'self', runId: 'craft-library-seed', synthetic: true };
      const artifact = artifacts.create({ title: '合成阅读方案 · '.repeat(8), kind: 'document' }, actor);
      const stage = artifacts.stage(artifact.id, 'craft-library-seed', null, actor);
      artifacts.write(stage.id, { path: 'brief.md', text: '# 两种阅读方案\n\n| 方案 | 时间 |\n| --- | --- |\n| A | 20 分钟 |\n| B | 30 分钟 |', expectedHash: null }, actor);
      artifacts.integrate(artifacts.submit(stage.id, actor).id, actor);
      artifactId = artifact.id;
    } finally { store.close(); }
    app = await launchDesktopTest(_electron, { executablePath: requireDesktop('electron'), args: [resolve('apps/desktop')], env });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ colorScheme: 'light' });
    await bounds(1200, 780);
    await page.getByTestId('im-nav-library').click();
    await expect(page.getByTestId(`library-artifact-${artifactId}`)).toBeVisible();
    await expect(page.getByTestId('library-welcome')).toContainText('选择一件作品');
    await expect(page.getByTestId('library-welcome-start')).toHaveCount(0);
    await shot('09-library-populated');
    await page.getByTestId('im-search').fill('没有这件作品');
    await expect(page.getByTestId('library-clear-search')).toBeVisible();
    await page.getByTestId('library-clear-search').click();
    await page.getByTestId(`library-artifact-${artifactId}`).click();
    await expect(page.getByTestId('artifact-workspace')).toContainText('两种阅读方案');
    await page.getByTestId('artifact-tab-files').click();
    await expect(page.getByTestId('artifact-file-content')).toContainText('20 分钟');
    await shot('10-library-files');
    await bounds(640, 780);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
    expect(await page.evaluate(() => innerWidth)).toBe(320);
    expect(await page.getByTestId('artifact-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.getByTestId('artifact-revision-select').evaluate(node => node.parentElement.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
    await expect(page.getByTestId('artifact-tab-files')).toBeInViewport();
    await shot('11-library-narrow');
    expect(errors).toEqual([]);
    check('a real committed document remains searchable and opens its persisted file from the populated library');
  }
  await writeFile(join(output, 'results.json'), JSON.stringify({ baseline, output, checks, errors, synthetic: true }, null, 2));
  console.log(JSON.stringify({ output, checks }));
} catch (error) {
  await shot('failure').catch(() => {});
  throw error;
} finally { await app.close(); }
