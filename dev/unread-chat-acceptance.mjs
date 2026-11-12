// Real Electron UI with isolated synthetic arrivals, never the owner's workspace.
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join, isAbsolute, resolve } from 'node:path';
import { PersonalStore } from '../apps/personal/server/store.mjs';
import { UnreadMessages } from '../apps/personal/server/unread.mjs';
import { cleanDesktopTestEnv, launchDesktopTest } from './desktop-test-env.mjs';
const parent = process.env.AGENTROOM_UNREAD_EVIDENCE_DIR;
if (!parent || !isAbsolute(parent)) throw Error('Set AGENTROOM_UNREAD_EVIDENCE_DIR to a registered absolute artifact directory');
const output = await mkdtemp(join(parent, 'unread-')), profile = join(output, 'profile'), directory = join(profile, 'personal');
const store = new PersonalStore(directory), unread = new UnreadMessages(store), at = '2026-11-12T00:00:00Z';
for (const [id, name, color] of [['self', '合成未读验收', 'teal'], ['fixture_a', '设计伙伴', 'blue'], ['fixture_b', '研究伙伴', 'violet']]) store.put('contact', { id, name, kind: id === 'self' ? 'human' : 'agent', handle: id, color, description: '合成界面验收', instructions: '', version: 1, availability: id === 'self' ? 'self' : 'local_only', binding: null });
function seed(id, title, memberId, count, kind = 'direct') {
 const messages = Array.from({ length: count }, (_, i) => ({ id: `${id}_${i}`, role: 'assistant', contactId: memberId, text: `${title}第 ${i + 1} 条回复。\n\n${'用于验证翻历史消息时不会清除未读。'.repeat(id === 'thr_history' ? 28 : 1)}`, createdAt: at }));
 store.put('thread', { id, title, kind, memberIds: ['self', memberId], version: 1, status: 'completed', summary: '', createdAt: at, updatedAt: at, messages, runs: [], decisions: [], events: [], artifacts: [] });
}
seed('thr_history', '设计讨论', 'fixture_a', 20); unread.markRead('thr_history', 'thr_history_17');
seed('thr_group', '产品讨论群', 'fixture_b', 1, 'group'); seed('thr_many', '研究资料', 'fixture_b', 104);
store.put('thread', { id: 'thr_late', title: '旧问题迟到回复', kind: 'group', memberIds: ['self', 'fixture_b'], version: 1, status: 'completed', summary: '', createdAt: at, updatedAt: at,
 messages: [...Array.from({ length: 200 }, (_, i) => ({ id: `old_question_${i}`, role: 'user', text: `问题 ${i}`, createdAt: at })), { id: 'late_reply', role: 'assistant', text: '迟到的旧问题回复', runId: 'old_run', contactId: 'fixture_b', createdAt: at }],
 runs: [{ id: 'old_run', messageId: 'old_question_0', status: 'completed', createdAt: at }], decisions: [], events: [], artifacts: [] });
store.db.close(); store.lockDb.close();
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url)), { _electron, expect } = require('@playwright/test');
const checks = [], errors = [], pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const env = cleanDesktopTestEnv({ ...process.env, AGENTSTUDIO_USER_DATA_DIR: profile, AGENTSTUDIO_WORKSPACE: 'personal', AGENTSTUDIO_MOCK_KEYCHAIN: '1', AGENTSTUDIO_CODEX_BIN: join(output, 'missing'), AGENTSTUDIO_CLAUDE_BIN: join(output, 'missing'), AGENTSTUDIO_PI_BIN: join(output, 'missing') });
const target = process.env.AGENTSTUDIO_PACKAGED_APP;
const launch = () => launchDesktopTest(_electron, { executablePath: target ? join(target, 'Contents/MacOS/AgentRoom') : require('electron'), args: target ? [] : [resolve('apps/desktop')], env });
const append = id => {
 const db = new DatabaseSync(join(directory, 'personal.sqlite'));
 try { const thread = JSON.parse(db.prepare("SELECT body FROM documents WHERE kind='thread' AND id=?").get(id).body);
  thread.messages.push({ id: `${id}_late_${thread.messages.length}`, role: 'assistant', text: '这是刚收到的新回复。', createdAt: new Date().toISOString(), contactId: thread.memberIds[1] }); thread.updatedAt = new Date().toISOString();
  db.prepare("UPDATE documents SET body=? WHERE kind='thread' AND id=?").run(JSON.stringify(thread), id);
 } finally { db.close(); }
};
let app;
try {
 app = await launch(); let page = await app.firstWindow();
 // Playwright can focus WebContents without focusing the hidden native window.
 await page.evaluate(() => { document.hasFocus = () => false; });
 expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
 await app.evaluate(({ BrowserWindow, nativeTheme }) => { BrowserWindow.getAllWindows()[0].setBounds({ width: 1200, height: 820 }); nativeTheme.themeSource = 'light'; });
 page.on('pageerror', error => errors.push(error.message));
 const api = (path, body) => page.evaluate(async ({ path, body }) => { const r = await window.agentStudioPersonal.request({ path: '/api' + path, method: body ? 'POST' : 'GET', ...(body ? { body } : {}) }); if (r.status >= 400) throw Error(JSON.stringify(r)); return r.body; }, { path, body });
 const refresh = () => page.getByTestId('im-refresh').click(), readCount = async id => (await api('/threads/' + id)).unreadCount;
 await expect(page.getByTestId('im-unread-thr_history')).toHaveText('2');
 await expect(page.getByTestId('im-unread-thr_many')).toHaveText('99+'); await expect(page.getByTestId('im-unread-thr_many')).toHaveAttribute('aria-label', '104 条未读消息');
 await expect(page.getByTestId('im-unread-total')).toHaveAttribute('aria-label', '108 条未读消息');
 await page.getByTestId('im-pin-thr_history').click(); await expect(page.getByTestId('im-pinned-unread-thr_history')).toHaveText('2');
 await page.screenshot({ path: join(output, '01-unread-badges.png') }); pass('row, group, pinned and navigation badges; 99+ overflow with exact accessible count');
 await page.getByTestId('im-filter-toggle').click(); await page.getByTestId('im-filter-unread').click(); await page.getByTestId('im-search').fill('产品讨论群');
 await expect(page.getByTestId('im-chat-thr_group')).toBeVisible(); await expect(page.getByTestId('im-chat-thr_history')).toHaveCount(0); await page.getByTestId('im-search').fill(''); pass('unread filtering composes with search');
 await page.getByTestId('im-chat-thr_history').click(); await expect(page.getByTestId('im-timeline')).toBeVisible();
 expect(await page.evaluate(() => document.hasFocus())).toBe(false); await refresh(); await expect(page.getByTestId('im-unread-thr_history')).toHaveText('2'); expect(await readCount('thr_history')).toBe(2); pass('unfocused native window preserves unread');
 await page.evaluate(() => { document.hasFocus = () => true; window.dispatchEvent(new Event('focus')); });
 await expect.poll(() => readCount('thr_history')).toBe(0); await expect(page.getByTestId('im-unread-thr_history')).toHaveCount(0); await expect(page.getByTestId('im-pinned-unread-thr_history')).toHaveCount(0); pass('visible latest messages clear row and pinned badges');
 // Restore all chats after the active unread conversation disappears from the filter.
 await page.getByTestId('im-filter-toggle').click(); await page.getByTestId('im-filter-all').click();
 await page.getByTestId('im-timeline').evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); }); append('thr_history'); await refresh();
 await expect(page.getByTestId('im-unread-thr_history')).toHaveText('1'); expect(await readCount('thr_history')).toBe(1); await page.screenshot({ path: join(output, '02-reading-history.png') });
 await page.getByTestId('im-timeline').evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); }); await expect.poll(() => readCount('thr_history')).toBe(0); pass('history scrolling preserves unread until returning to latest');
 await page.getByTestId('im-nav-contacts').click(); append('thr_history'); await refresh(); await expect(page.getByTestId('im-unread-total')).toHaveAttribute('aria-label', '107 条未读消息'); expect(await readCount('thr_history')).toBe(1); pass('other screens preserve unread');
 await page.getByTestId('im-nav-chats').click(); await expect.poll(() => readCount('thr_history')).toBe(0);
 await page.getByTestId('im-settings').click(); append('thr_history'); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await expect(page.getByTestId('im-unread-thr_history')).toHaveText('1'); expect(await readCount('thr_history')).toBe(1);
 await page.keyboard.press('Escape'); await expect.poll(() => readCount('thr_history')).toBe(0); pass('a covering dialog preserves unread until closed');
 await page.getByTestId('im-chat-thr_late').click(); await refresh();
 const late = page.getByTestId('im-message').filter({ hasText: '迟到的旧问题回复' });
 await expect(late).toHaveCount(0); await expect(page.getByTestId('im-unread-thr_late')).toHaveText('1'); expect(await readCount('thr_late')).toBe(1);
 await page.getByTestId('im-load-more').click(); await late.scrollIntoViewIfNeeded();
 await page.getByTestId('im-timeline').evaluate(node => node.dispatchEvent(new Event('scroll')));
 await expect.poll(() => readCount('thr_late')).toBe(0); pass('a late old-run reply stays unread outside rendered rows and clears only when visible');
 await page.getByTestId('im-chat-thr_history').click();
 await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setBounds({ width: 640, height: 820 }); });
 await expect(page.getByTestId('im-back')).toBeVisible(); await page.getByTestId('im-back').click(); append('thr_history'); await refresh(); await expect(page.getByTestId('im-unread-thr_history')).toHaveText('1'); expect(await readCount('thr_history')).toBe(1); pass('narrow list view does not read the hidden detail');
 await app.close(); app = await launch(); page = await app.firstWindow(); await expect(page.getByTestId('im-unread-thr_history')).toHaveText('1'); await expect(page.getByTestId('im-unread-thr_many')).toHaveText('99+'); pass('native restart preserves unread state');
 expect(errors).toEqual([]); await writeFile(join(output, 'results.json'), JSON.stringify({ checks, errors, synthetic: true, arrivals: 'isolated SQLite fixture injection', focus: 'document focus simulated; native window stays hidden' }, null, 2)); console.log(JSON.stringify({ output, checks: checks.length, errors }));
} finally { await app?.close(); }
