// Run the real Electron WebSession against a page whose media never finishes.
// No accounts, service cookies or model calls are involved.
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cleanDesktopTestEnv } from './desktop-test-env.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireDesktop = createRequire(join(root, 'apps/desktop/package.json'));
const parent = process.env.AGENTSTUDIO_DESKTOP_EVIDENCE_DIR || join(root, 'output/websession-isolation');
await mkdir(parent, { recursive: true });
const evidence = await mkdtemp(join(parent, 'electron-'));
for (const name of ['websession', 'nettrace']) {
  const source = await readFile(join(root, 'apps/desktop/src/main/connectors', `${name}.ts`), 'utf8');
  await writeFile(join(evidence, `${name}.mjs`), stripTypeScriptTypes(source, { mode: 'transform' })
    .replace('"./nettrace"', '"./nettrace.mjs"'));
}
const runner = String.raw`
import { app } from 'electron';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { WebSession } from './websession.mjs';
async function main() {
app.setPath('userData', process.env.AGENTSTUDIO_USER_DATA_DIR);
await app.whenReady();
let session;
const sockets = new Set();
const server = createServer((req, res) => {
  if (req.url === '/never.png') return;
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><textarea aria-label="Message"></textarea><img src="/never.png"><script>globalThis.pageSecret = 123</script>');
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
const deadline = setTimeout(() => { console.error('FAIL driver waited for full navigation'); app.exit(1); }, 15000);
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  session = new WebSession({ partition: 'persist:synthetic-isolation', url: 'http://127.0.0.1:' + server.address().port, title: 'Synthetic isolation' });
  await session.open();
  const wc = session.webContents;
  await once(wc, 'dom-ready');
  const checks = [];
  const verify = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  verify(wc.isLoading(), 'media still loading');
  verify(await session.eval('typeof pageSecret') === 'undefined', 'page globals are isolated');
  verify(await session.eval('globalThis.driverState = 42') === 42, 'driver executes before full navigation');
  verify(await session.eval('driverState') === 42, 'isolated driver state survives separate evaluations');
  verify(await wc.mainFrame.executeJavaScript('typeof driverState') === 'undefined', 'page cannot see driver state');
  verify(wc.isLoading(), 'driver did not stop or alter outstanding media');
  await writeFile(process.env.ISOLATION_RESULTS, JSON.stringify({ electron: process.versions.electron, checks, passed: true }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  clearTimeout(deadline); session?.close(); for (const socket of sockets) socket.destroy(); server.close(); app.exit(process.exitCode || 0);
}
}
main().catch(error => { console.error(error); app.exit(1); });
`;
await writeFile(join(evidence, 'runner.mjs'), runner);
const env = cleanDesktopTestEnv({ ...process.env, AGENTSTUDIO_USER_DATA_DIR: join(evidence, 'profile'), ISOLATION_RESULTS: join(evidence, 'results.json') });
const child = spawn(requireDesktop('electron'), [join(evidence, 'runner.mjs'), '--use-mock-keychain'], { env, stdio: 'inherit' });
const exit = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
const result = await readFile(join(evidence, 'results.json'), 'utf8').then(JSON.parse).catch(() => null);
const passed = exit.code === 0 && !exit.signal && result?.passed === true && result.checks?.length === 6;
console.log(JSON.stringify({ evidence, ...exit, passed }));
process.exitCode = passed ? 0 : 1;
