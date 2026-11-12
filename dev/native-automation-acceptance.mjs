// A real Electron journey proving hidden automation, using only isolated records.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { cleanDesktopTestEnv, launchDesktopTest } from './desktop-test-env.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'apps/desktop/package.json'));
const { _electron, expect } = require('@playwright/test');
const parent = process.env.AGENTSTUDIO_DESKTOP_EVIDENCE_DIR || join(root, 'output/playwright/native-automation');
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'hidden-'));
const env = cleanDesktopTestEnv({ ...process.env, AGENTSTUDIO_USER_DATA_DIR: join(output, 'profile'), CODEX_HOME: join(output, 'codex-home'), AGENTSTUDIO_WORKSPACE: 'personal', AGENTSTUDIO_CODEX_BIN: join(output, 'missing'), AGENTSTUDIO_CLAUDE_BIN: join(output, 'missing'), AGENTSTUDIO_PI_BIN: join(output, 'missing'), AGENTSTUDIO_MOCK_KEYCHAIN: '1' });
delete env.AGENTROOM_AUTOMATION_VISIBLE;
const front = () => process.platform === 'darwin' ? execFileSync('/usr/bin/lsappinfo', ['front'], { encoding: 'utf8' }).trim() : null;
const before = front();
const target = process.env.AGENTSTUDIO_PACKAGED_APP;
const app = await launchDesktopTest(_electron, { executablePath: target ? join(target, 'Contents/MacOS/AgentRoom') : require('electron'), args: target ? [] : [join(root, 'apps/desktop')], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByTestId('im-app')).toBeVisible();
  const state = () => app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; return { visible: win.isVisible(), focused: win.isFocused(), focusable: win.isFocusable(), title: win.getTitle() }; });
  const initial = await state();
  expect(initial).toMatchObject({ visible: false, focused: false, focusable: false });
  expect(initial.title).toContain('自动化验收');
  await app.evaluate(({ app }) => { app.emit('activate'); app.emit('second-instance'); });
  await page.getByTestId('im-nav-contacts').click();
  await page.getByTestId('im-nav-chats').click();
  await page.getByTestId('im-settings').click();
  await page.keyboard.press('Escape');
  const screenshot = await page.screenshot({ path: join(output, 'hidden-renderer.png') });
  expect(screenshot.length).toBeGreaterThan(1000);
  expect(await state()).toEqual(initial);
  const after = front();
  expect(after).toBe(before);
  expect(errors).toEqual([]);
  const result = { initial, final: await state(), before, after, errors, screenshotBytes: screenshot.length, synthetic: true };
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, ...result }));
} finally { await app.close(); }
