// Actual Electron startup with a saved synthetic web connector and an image
// response that never finishes. Mock keychain applies only to this fresh profile.
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { _electron, expect } = requireDesktop('@playwright/test');
const parent = resolve(process.env.AGENTSTUDIO_DESKTOP_EVIDENCE_DIR || 'output/playwright/restore-startup');
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'synthetic-'));
const profile = join(output, 'profile');
const sockets = new Set(); let pendingResources = 0;
const fixture = createServer((req, res) => {
  if (req.url === '/unending.png') {
    pendingResources++;
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.write(Buffer.from([137, 80, 78, 71]));
    res.once('close', () => pendingResources--);
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><body><main>Synthetic signed-out service</main><img src="/unending.png"></body></html>');
  }
});
fixture.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
await new Promise(done => fixture.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${fixture.address().port}`;
const lease = createServer(); await new Promise(done => lease.listen(0, '127.0.0.1', done));
const chosenPort = lease.address().port; await new Promise(done => lease.close(done));
const env = { ...process.env, AGENTSTUDIO_USER_DATA_DIR: profile, AGENTSTUDIO_PI_BIN: '/agentstudio-synthetic-missing-pi', AGENTSTUDIO_CLAUDE_BIN: '/agentstudio-synthetic-missing-claude', AGENTSTUDIO_WORKSPACE: 'personal',
  AGENTSTUDIO_MOCK_KEYCHAIN: '1', AGENTSTUDIO_MUSE_URL: `${origin}/muse/`, AGENTSTUDIO_CODEX_BIN: join(output, 'missing-no-model'),
  AGENTSTUDIO_CONNECTOR_PORT: '0', NO_PROXY: [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',') };
for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'AGENTSTUDIO_PERSONAL_DATA_DIR', 'PERSONAL_DATA_DIR']) delete env[name];
let application, page;
const checks = [], errors = [];
const check = text => { checks.push(text); console.log(`PASS ${text}`); };
const api = (path) => page.evaluate(async path => {
  const result = await window.agentStudioPersonal.request({ path: `/api${path}`, method: 'GET' });
  if (result.status >= 300) throw new Error(`API HTTP ${result.status}`);
  return result.body;
}, path);
const launch = async () => {
  const packaged = process.env.AGENTSTUDIO_PACKAGED_APP;
  application = await _electron.launch({ executablePath: packaged ? join(packaged, 'Contents/MacOS/AgentStudio') : requireDesktop('electron'), args: packaged ? [] : [resolve('apps/desktop')], env, timeout: 20000 });
  // Restored connector windows may be created before the personal window.
  // Pick the bundled renderer rather than whichever window appears first.
  await expect.poll(() => application.windows().filter(window => window.url().startsWith('file://')).length).toBe(1);
  page = application.windows().find(window => window.url().startsWith('file://'));
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByTestId('im-app')).toBeVisible();
};
try {
  await launch(); await api('/health');
  const records = [{ id: 'synthetic_saved_muse', service: 'muse', name: 'Synthetic restored web agent',
    token: 'synthetic_restore_local_bearer_only', createdAt: new Date().toISOString(), data: { connectedAt: new Date().toISOString(), historyImported: true } }];
  const encrypted = await application.evaluate(({ safeStorage }, text) => Array.from(safeStorage.encryptString(text)), JSON.stringify(records));
  const directory = join(profile, 'personal-services'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'connectors.bin'), Buffer.from(encrypted), { mode: 0o600 });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: 1, chosenPort, tasks: [] }), { mode: 0o600 });
  await application.close(); application = null;
  await launch();
  await expect.poll(() => pendingResources, { timeout: 10000 }).toBeGreaterThan(0);
  const health = await Promise.race([api('/health'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Saved web page blocked local backend startup')), 8000); timer.unref(); })]);
  check('saved web connector restores while a page resource never finishes');
  const bootstrap = await api('/bootstrap');
  expect(bootstrap.connections).toHaveLength(1); expect(bootstrap.threads).toHaveLength(0);
  check('owned local backend and connection registration are available without a model call');
  const native = await page.evaluate(() => window.agentStudioPersonal.nativeIntegration({ kind: 'services' }));
  expect(native.instances).toHaveLength(1);
  expect(native.instances[0].instanceId || native.instances[0].id).toBe(records[0].id);
  expect(JSON.stringify(native)).not.toContain(records[0].token);
  check('restored catalog keeps its identity and never exposes its bearer');
  const serviceLoading = await application.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().startsWith(origin)).some(win => win.webContents.isLoading()), origin);
  expect(serviceLoading).toBe(true);
  check('workspace becomes usable before the third-party navigation finishes');
  await page.getByTestId('im-nav-contacts').click();
  await expect(page.getByTestId('im-main')).toContainText('认识你的下一位伙伴');
  await page.screenshot({ path: join(output, 'restored-workspace.png') });
  const at = Date.now(); await application.close(); application = null;
  expect(Date.now() - at).toBeLessThan(8000);
  check('quit closes the owned loading session without waiting for its network response');
  expect(errors).toEqual([]); check('no renderer exceptions');
  await writeFile(join(output, 'health.json'), JSON.stringify(health, null, 2));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); throw error;
} finally {
  await application?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise(done => fixture.close(done));
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ synthetic: true, mockKeychain: true, checks, errors, output }, null, 2));
  console.log(JSON.stringify({ output, passed: checks.length }));
}
