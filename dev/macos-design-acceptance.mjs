import { seedLegacyAgentContacts } from "./legacy-agent-fixture.mjs";
import { cleanDesktopTestEnv } from './desktop-test-env.mjs';
// Synthetic design acceptance. No real model, account or existing profile is used.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPersonalServer } from '../apps/personal/server/index.mjs';

const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { chromium, _electron } = createRequire(requireDesktop.resolve('@playwright/test'))('playwright');
const { expect } = requireDesktop('@playwright/test');
const native = process.argv.includes('--native');
const parent = resolve(process.env.AGENTSTUDIO_DESIGN_EVIDENCE_DIR || 'output/playwright/macos-design');
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, native ? 'native-' : 'browser-'));
const missing = join(output, 'intentionally-missing-cli');
const checks = [], errors = [], captures = [];
let server, browser, application, page;
const check = label => { checks.push(label); console.log(`PASS ${label}`); };
const shot = async name => {
  await page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' });
  if (native && process.platform === 'darwin' && ['conversation-light', 'conversation-dark'].includes(name)) {
    const source = await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); return win.getMediaSourceId(); });
    const path = join(output, `${name}-macos.png`);
    try {
      execFileSync('/usr/sbin/screencapture', ['-x', '-l', source.split(':')[1], path], { timeout: 10000, stdio: 'pipe' });
      captures.push({ path, kind: 'macos-window' });
    } catch {
      captures.push({ kind: 'renderer-only', reason: 'OS window capture unavailable' });
    }
  }
};
const request = async (path, body) => {
  if (native) return page.evaluate(async ({ path, body }) => {
    const response = await window.agentStudioPersonal.request({ path: `/api${path}`, method: body ? 'POST' : 'GET', ...(body ? { body } : {}) });
    if (response.status >= 400) throw new Error(`Synthetic API: ${response.status}`);
    return response.body;
  }, { path, body });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Synthetic API: ${response.status}`);
  return response.json();
};

seedLegacyAgentContacts(native ? join(output, "profile", "personal") : join(output, "data"));
try {
  if (native) {
    const env = { ...process.env, CODEX_HOME: output, AGENTSTUDIO_WORKSPACE: 'personal', AGENTSTUDIO_USER_DATA_DIR: join(output, 'profile'), AGENTSTUDIO_CODEX_BIN: missing, AGENTSTUDIO_CLAUDE_BIN: missing, AGENTSTUDIO_PI_BIN: missing, AGENTSTUDIO_MOCK_KEYCHAIN: '1' };
    cleanDesktopTestEnv(env);
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'AGENTSTUDIO_PERSONAL_DATA_DIR', 'PERSONAL_DATA_DIR']) delete env[key];
    application = await _electron.launch({ executablePath: requireDesktop('electron'), args: [resolve('apps/desktop')], env });
    page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow, nativeTheme }) => { nativeTheme.themeSource = 'light'; BrowserWindow.getAllWindows()[0].setBounds({ width: 1200, height: 780 }); });
  } else {
    server = await createPersonalServer({ dataDir: join(output, 'data'), port: 0, codexCommand: missing, localAgentDeps: { env: { ...process.env, CODEX_HOME: output }, commands: { codex: missing, claude: missing, pi: missing, gemini: missing, opencode: missing } }, staticDir: resolve('apps/personal/dist') });
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}) });
    page = await browser.newPage({ viewport: { width: 1200, height: 780 }, colorScheme: 'light' });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
  }
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByTestId('im-list-panel')).toHaveAttribute('aria-label', '会话列表');
  await shot('home-light');
  check('empty workspace shows real empty state, without invented conversations');
  await page.getByTestId('im-nav-contacts').click();
  for (const agent of ['codex', 'claude', 'pi', 'gemini', 'opencode']) {
    const avatar = page.getByTestId(`im-contact-agent_${agent}`).getByTestId('im-avatar');
    await expect(avatar).toHaveAttribute('data-avatar-source', agent);
    await expect.poll(() => avatar.evaluate(node => node.querySelector('img')?.naturalWidth || 0)).toBeGreaterThan(0);
  }
  await shot('agent-avatars');
  await page.getByTestId('im-nav-chats').click();
  check('all five local agents have bundled, successfully loaded brand avatars');

  const first = await request('/threads', { text: '合成设计验收：让阅读回到内容本身。\n\n这是一份隔离测试资料，没有调用模型。\n\n- 留出舒适的阅读空间\n- 让工具在需要时出现\n- 保留每一份草稿', mode: 'local', clientId: 'design-acceptance-first' });
  await request('/threads', { text: '合成设计验收：下一段想法，随时接着聊。', mode: 'local', clientId: 'design-acceptance-second' });
  await expect.poll(async () => (await request(`/threads/${first.id}`)).status).toBe('completed');
  await page.goto(`${page.url().split('?')[0]}?thread=${first.id}`);
  await expect(page.getByTestId('im-message').first()).toBeVisible();
  const cleanReply = page.getByTestId('im-message').last();
  await expect(cleanReply).not.toContainText('打开原文');
  expect(await cleanReply.getByTestId('im-message-content').evaluate(node => Boolean(node.querySelector('time, button.im-sender, .im-message-meta')))).toBe(false);
  await expect(cleanReply.getByTestId('im-avatar')).toHaveCount(0);
  await page.getByTestId('im-results').click();
  await expect(page.getByTestId('im-artifact')).toHaveCount(1);
  await page.getByTestId('im-artifact').click();
  await expect(page.getByTestId('personal-reader')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  check('replies contain only their content; original artifacts stay accessible through conversation info');
  await expect(page.getByTestId('im-list-panel')).toHaveAttribute('aria-label', '会话列表');
  const draft = '合成草稿：收起列表、刷新和调整窗口后，继续写。';
  await page.getByTestId('im-message-input').fill(draft);
  const group = await request('/chats', { kind: 'group', title: '合成设计小组', memberIds: ['agent_codex', 'agent_claude'], clientId: 'design-pinned-group' });
  const direct = await request('/chats', { kind: 'direct', memberIds: ['agent_codex'], clientId: 'design-pinned-direct' });
  await page.getByTestId('im-refresh').click();
  await expect(page.getByTestId(`im-chat-${group.id}`)).toBeVisible();
  const rail = await page.getByTestId('im-rail').boundingBox();
  const list = await page.getByTestId('im-list-panel').boundingBox();
  expect(rail.x + rail.width).toBeLessThanOrEqual(list.x + 1);
  expect(await page.getByTestId('im-list-panel').evaluate(node => Boolean(node.querySelector('h1')))).toBe(false);
  await expect(page.getByTestId('im-profile')).toBeVisible();
  check('owner and navigation occupy a left rail; the list has no redundant heading');
  for (const chat of [first, group, direct]) {
    await page.getByTestId(`im-chat-${chat.id}`).hover();
    await page.getByTestId(`im-pin-${chat.id}`).click();
    // Pinning restores row focus on the next animation frame. Settle that
    // documented transition before sending a key to a different shortcut.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await expect(page.getByTestId(`im-pin-${chat.id}`)).toBeFocused();
  }
  const pinnedOrder = () => page.getByTestId('im-pinned').evaluate(node => [...node.querySelectorAll('button')].map(item => item.dataset.testid));
  await expect.poll(pinnedOrder).toEqual([first, group, direct].map(chat => `im-pinned-${chat.id}`));
  await page.getByTestId(`im-pinned-${direct.id}`).press('Alt+ArrowLeft');
  await expect.poll(pinnedOrder).toEqual([first, direct, group].map(chat => `im-pinned-${chat.id}`));
  await page.reload();
  await expect.poll(pinnedOrder).toEqual([first, direct, group].map(chat => `im-pinned-${chat.id}`));
  await page.getByTestId(`im-pinned-${direct.id}`).press('Shift+F10');
  await expect(page.getByTestId('im-conversation-menu')).toBeVisible();
  const menuBounds = await page.getByTestId('im-conversation-menu').boundingBox();
  expect(menuBounds.x).toBeGreaterThanOrEqual(8);
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.getByTestId('im-menu-pin').click();
  await expect(page.getByTestId(`im-pinned-${direct.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`im-chat-${direct.id}`)).toBeFocused();
  await page.getByTestId(`im-pin-${direct.id}`).click();
  check('circular pins persist in explicit order; keyboard reordering and unpin focus work');

  await page.getByTestId('im-search').fill('合成设计');
  await expect(page.getByTestId('im-filter-options')).toBeHidden();
  await page.getByTestId('im-filter-toggle').click();
  await expect(page.getByTestId('im-search')).toHaveValue('合成设计');
  await page.getByTestId('im-filter-group').click();
  await expect(page.getByTestId(`im-chat-${group.id}`)).toBeVisible();
  await expect(page.getByTestId(`im-chat-${first.id}`)).toHaveCount(0);
  await shot('integrated-group-filter');
  await page.getByTestId(`im-chat-${group.id}`).click();
  await expect(page.getByTestId('im-search')).toHaveValue('合成设计');
  await expect(page.getByTestId('im-filter-toggle')).toHaveAttribute('aria-label', '筛选：群聊');
  await page.getByTestId('im-filter-toggle').click();
  await page.getByTestId('im-filter-pinned').click();
  await page.getByTestId('im-search').fill('Codex');
  await page.getByTestId(`im-chat-${direct.id}`).hover();
  await page.getByTestId(`im-pin-${direct.id}`).click();
  await expect(page.getByTestId('im-filter-toggle')).toBeFocused();
  await expect(page.getByTestId(`im-chat-${direct.id}`)).toHaveCount(0);
  await page.getByTestId('im-filter-toggle').click();
  await page.getByTestId('im-filter-all').click();
  await page.getByTestId('im-search').fill('');
  await page.getByTestId(`im-chat-${direct.id}`).hover();
  await page.getByTestId(`im-pin-${direct.id}`).click();
  await page.getByTestId(`im-chat-${first.id}`).click();
  await expect(page.getByTestId('im-message-input')).toHaveValue(draft);
  check('search and filter are independent, compose correctly and preserve the query on chat open');
  await shot('conversation-light');
  await page.getByTestId('im-focus-toggle').click();
  await expect(page.getByTestId('im-list-panel')).toBeHidden();
  await expect(page.getByTestId('im-rail')).toBeVisible();
  await expect(page.getByTestId('im-focus-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('im-message-input')).toHaveValue(draft);
  await shot('focused-light');
  await page.reload();
  await expect(page.getByTestId('im-message-input')).toHaveValue(draft);
  await expect(page.getByTestId('im-list-panel')).toBeHidden();
  check('focus mode and the same unsent draft survive reload');

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('im-list-panel')).toBeVisible();
  await expect(page.getByTestId('im-search')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+\\');
  await expect(page.getByTestId('im-list-panel')).toBeHidden();
  await expect(page.getByTestId('im-focus-toggle')).toBeFocused();
  await page.getByTestId('im-focus-toggle').click();
  await page.getByTestId('im-nav-contacts').click();
  await expect(page.getByTestId('im-list-panel')).toBeVisible();
  await page.getByTestId('im-nav-chats').click();
  await page.getByTestId(`im-chat-${first.id}`).click();
  check('search and navigation restore the list; hiding a focused list restores keyboard focus');

  await page.getByTestId('im-new').click();
  await expect(page.getByTestId('personal-modal')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+\\');
  await expect(page.getByTestId('im-list-panel')).toBeVisible();
  await shot('new-chat-dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('personal-modal')).toBeHidden();
  await page.getByTestId('im-message').first().hover();
  await expect(page.getByTestId('im-reply-message').first()).toBeVisible();
  check('dialog owns shortcuts and contextual reply tools remain reachable');

  if (native) await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect.poll(() => page.getByTestId('im-main').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(29, 35, 42)');
  await expect.poll(() => page.getByTestId('im-send').evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
  await shot('conversation-dark');
  await page.getByTestId('im-new').click();
  await shot('dialog-dark');
  await page.keyboard.press('Escape');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-contrast', value: 'more' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await expect.poll(() => page.getByTestId('im-list-panel').evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
  await expect.poll(() => page.getByTestId('im-app').evaluate(node => { const style = getComputedStyle(node); return style.getPropertyValue('--im-muted').trim() === style.getPropertyValue('--im-ink').trim(); })).toBe(true);
  await shot('accessibility-dark');
  await cdp.detach();
  check('dark appearance, reduced motion, solid materials and increased contrast work');

  await page.getByTestId('im-focus-toggle').click();
  if (native) await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setBounds({ width: 760, height: 780 }); win.webContents.setZoomFactor(1.25); });
  else await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.getByTestId('im-back')).toBeVisible();
  await expect(page.getByTestId('im-focus-toggle')).toBeHidden();
  await expect(page.getByTestId('im-message-input')).toHaveValue(draft);
  await expect.poll(() => page.getByTestId('im-composer').evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await shot('narrow-conversation');
  await page.getByTestId('im-back').click();
  await expect(page.getByTestId('im-list-panel')).toBeVisible();
  await expect(page.getByTestId('im-search')).toBeVisible();
  await expect(page.getByTestId('im-new')).toBeVisible();
  await shot('narrow-sidebar');
  await page.getByTestId(`im-pinned-${group.id}`).click({ button: 'right' });
  const narrowMenu = await page.getByTestId('im-conversation-menu').boundingBox();
  expect(narrowMenu.x + narrowMenu.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.keyboard.press('Escape');
  await page.getByTestId(`im-chat-${first.id}`).click();
  await expect(page.getByTestId('im-message-input')).toHaveValue(draft);
  expect(await page.getByTestId('im-app').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  check('saved focus preference cannot hide narrow navigation; Back and draft remain intact');
  if (!native) {
    const touch = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
    touch.on('pageerror', error => errors.push(error.message));
    await touch.goto(page.url());
    await expect(touch.getByTestId('im-message')).toHaveCount(2);
    for (const message of await touch.getByTestId('im-message').all()) {
      const content = await message.getByTestId('im-message-content').boundingBox();
      const actions = await message.getByTestId('im-message-actions').boundingBox();
      expect(actions.y).toBeGreaterThanOrEqual(content.y + content.height);
    }
    await touch.screenshot({ path: join(output, 'touch-tools.png') });
    await touch.close();
    check('touch reply/copy tools have their own row and cannot cover the message content');
  }
  expect(errors).toEqual([]);
} finally {
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ synthetic: true, native, checks, errors, captures }, null, 2));
  await application?.close(); await browser?.close(); await server?.close();
  console.log(`Evidence: ${output}`);
}
