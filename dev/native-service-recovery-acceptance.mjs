// Saved synthetic native services with missing login records. No real accounts/model.
// Browser plugin not available; use the repository's isolated Electron harness.
import { createRequire } from 'node:module';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { PersonalStore, connectionIdentity } from '../apps/personal/server/store.mjs';
import { Messenger } from '../apps/personal/server/messenger.mjs';
import { cleanDesktopTestEnv, launchDesktopTest } from './desktop-test-env.mjs';
const output = process.env.AGENTSTUDIO_DESKTOP_EVIDENCE_DIR;
if (!output) throw new Error('Set AGENTSTUDIO_DESKTOP_EVIDENCE_DIR to a registered artifact directory');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'synthetic-recovery-'));
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { _electron, expect } = requireDesktop('@playwright/test');
const lease = createServer(); await new Promise(done => lease.listen(0, '127.0.0.1', done));
const port = lease.address().port; await new Promise(done => lease.close(done));
const servicesDir = join(profile, 'personal-services'); await mkdir(servicesDir);
await writeFile(join(servicesDir, 'manifest.json'), JSON.stringify({ version: 1, chosenPort: port, tasks: [] }), { mode: 0o600 });
const store = new PersonalStore(join(profile, 'personal'));
const messenger = new Messenger(store);
for (const [id, service, name, image] of [['grok', 'grokbot', '调研伙伴', 'grokbot.png'], ['muse', 'muse', 'Muse', 'muse-mark.png']]) {
 const connection = { id: `con_${id}`, type: 'a2a', name, url: `http://127.0.0.1:${port}/a2a/${id}` };
 store.put('connection', connection);
 store.put('native_service_source', { id: connection.id, instanceId: id, service, status: 'ready', identity: connectionIdentity(connection),
  avatarDataUrl: `data:image/png;base64,${(await readFile(new URL(`../packages/brand/assets/${image}`, import.meta.url))).toString('base64')}` });
}
messenger.sync({ agents: [] });
const chat = messenger.createChat({ kind: 'group', title: '发送状态验收', memberIds: ['connection_con_grok', 'connection_con_muse'] });
for (const id of ['grok', 'muse']) {
 const contact = store.require('contact', `connection_con_${id}`);
 const run = store.appendRun(chat, { text: `Synthetic greeting for ${id}`, mode: 'connection', connectionId: `con_${id}`, contactId: contact.id, contactSnapshot: contact });
 Object.assign(run, { status: 'unknown', phase: 'dispatch', deliveryState: 'unknown', requiresReconciliation: true, finishedAt: '2026-11-11T00:00:00Z' });
}
store.put('thread', chat); store.close();
let application, page; const errors = [], checks = [];
const request = async path => page.evaluate(async path => {
 const response = await window.agentStudioPersonal.request({ path: `/api${path}`, method: 'GET' });
 if (response.status >= 300) throw new Error('API failure'); return response.body;
}, path);
try {
 const env = cleanDesktopTestEnv({ ...process.env, AGENTSTUDIO_USER_DATA_DIR: profile, AGENTSTUDIO_MOCK_KEYCHAIN: "1",
  AGENTSTUDIO_CODEX_BIN: '/synthetic-no-model', AGENTSTUDIO_CLAUDE_BIN: '/synthetic-no-model', AGENTSTUDIO_PI_BIN: '/synthetic-no-model' });
 application = await launchDesktopTest(_electron, { executablePath: requireDesktop('electron'), args: [resolve('apps/desktop')], env, timeout: 25000 });
 await expect.poll(() => application.windows().filter(window => window.url().startsWith('file://')).length).toBe(1);
 page = application.windows().find(window => window.url().startsWith('file://'));
 page.on('pageerror', error => errors.push(error.message));
 await page.getByTestId('im-app').waitFor();
 const contacts = (await request('/contacts')).contacts;
 expect(contacts.filter(contact => contact.id.startsWith('connection_')).every(contact => contact.availability === 'disconnected')).toBe(true);
 const recovered = await request(`/threads/${chat.id}`);
 expect(recovered.runs.every(run => run.status === 'failed' && run.deliveryState === 'not_sent' && !run.requiresReconciliation)).toBe(true);
 checks.push('owner startup recovers only unsent requests without a provider send');
 await page.goto(`${page.url().split('?')[0]}?thread=${chat.id}`);
 await expect(page.getByTestId('im-run-status')).toHaveCount(2);
 await expect(page.getByTestId('im-run-status').first()).toContainText('调研伙伴 · 未发送');
 await expect(page.getByTestId('im-run-status').last()).toContainText('Muse · 未发送');
 await expect(page.getByTestId('im-run-status').first().getByTestId('im-avatar-image')).toBeVisible();
 await page.screenshot({ path: join(output, 'group-unsent.png') });
 checks.push('group names, unsent state, preserved service images and connection action render');
 await page.getByTestId('im-run-status').first().getByRole('button', { name: '检查连接', exact: true }).click();
 await expect(page.getByTestId('personal-service-instances-grokbot')).toContainText('登录记录未恢复');
 await expect(page.getByTestId('personal-service-instances-muse')).toContainText('登录记录未恢复');
 await expect(page.getByTestId('personal-service-instances-muse').getByTestId('im-avatar-image')).toBeVisible();
 await page.getByTestId('personal-service-instances-muse').scrollIntoViewIfNeeded();
 await page.screenshot({ path: join(output, 'service-recovery.png') });
 checks.push('connection recovery opens safe original service rows with retained avatars');
 expect(errors).toEqual([]); checks.push('no renderer exceptions');
} finally {
 await application?.close();
 await writeFile(join(output, 'receipt.json'), JSON.stringify({ synthetic: true, noProviderRequests: true, checks, errors }, null, 2));
}
console.log(JSON.stringify({ checks }));
