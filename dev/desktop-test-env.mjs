import { dirname, isAbsolute, join, resolve } from 'node:path';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireDesktop = createRequire(join(sourceRoot, 'apps/desktop/package.json'));

function physicalPath(path) {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(physicalPath(parent), path.slice(parent.length + 1));
}

export function desktopSource(root = sourceRoot) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const head = git(['rev-parse', 'HEAD']).trim();
  const status = git(['status', '--porcelain', '--untracked-files=normal']);
  const hash = createHash('sha256').update(head).update(git(['diff', 'HEAD', '--binary']));
  for (const file of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort()) hash.update(file).update(readFileSync(join(root, file)));
  return { revision: `${head}${status.trim() ? '-dirty' : ''}`, fingerprint: hash.digest('hex'), automation: 1 };
}

/** Native acceptance must never inherit a user's real workspace or mode. */
export function cleanDesktopTestEnv(env) {
  if (typeof env.AGENTSTUDIO_USER_DATA_DIR !== 'string' || !isAbsolute(env.AGENTSTUDIO_USER_DATA_DIR)) throw new Error('Native acceptance requires an explicit absolute test profile');
  for (const key of ['AGENTROOM_USER_DATA_DIR', 'AGENTROOM_PERSONAL_DATA_DIR', 'AGENTSTUDIO_PERSONAL_DATA_DIR', 'AGENTROOM_TEST_MODE', 'PERSONAL_DATA_DIR', 'ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  return env;
}

/** Check the actual target before starting any executable; old bundles cannot opt in safely. */
export async function launchDesktopTest(electron, options, { lockPath = join(homedir(), '.local/state/agentroom-automation/desktop.lock'), runtimePath } = {}) {
  const env = cleanDesktopTestEnv({ ...options.env });
  const normal = resolve(homedir(), 'Library/Application Support/AgentStudio');
  const profile = physicalPath(resolve(env.AGENTSTUDIO_USER_DATA_DIR));
  if (profile === normal || profile.startsWith(`${normal}/`)) throw new Error('Native acceptance cannot use the real workspace');
  const pinnedElectron = realpathSync(runtimePath || requireDesktop('electron'));
  let executable;
  try { executable = realpathSync(options.executablePath || pinnedElectron); }
  catch { throw new Error('Unknown native test executable; use the pinned Electron runtime or an explicit AgentRoom.app'); }
  const packaged = executable.match(/^(.*\.app)\/Contents\/MacOS\/AgentRoom$/)?.[1];
  if (!packaged && executable !== pinnedElectron) throw new Error('Unknown native test executable; cannot verify the actual App');
  const appRoot = packaged ? join(packaged, 'Contents/Resources/app') : options.args?.[0];
  let info;
  try { info = JSON.parse(readFileSync(join(appRoot, 'out/main/build-info.json'), 'utf8')); }
  catch { throw new Error('Rebuild this App before native acceptance: build metadata is missing'); }
  if (info.automation !== 1) throw new Error('Rebuild this App with background automation support');
  const source = desktopSource();
  if (env.AGENTROOM_EXPECTED_BUILD_REF && !/^[a-f0-9]{40}$/.test(env.AGENTROOM_EXPECTED_BUILD_REF)) throw new Error('An explicit expected build ref must be a full clean Git SHA; dirty builds require the current source fingerprint');
  const expected = env.AGENTROOM_EXPECTED_BUILD_REF || source.revision;
  if (info.revision !== expected || (!env.AGENTROOM_EXPECTED_BUILD_REF && info.fingerprint !== source.fingerprint)) throw new Error(`Native automation build mismatch: expected ${expected}, actual ${info.revision}; rebuild the target`);
  env.AGENTSTUDIO_TEST_NOTIFICATIONS = '1';
  env.AGENTROOM_EXPECTED_BUILD_REF = expected;
  env.AGENTROOM_AUTOMATION_MODE = env.AGENTROOM_AUTOMATION_VISIBLE === '1' ? 'visible' : 'background';
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID(), revision: info.revision });
  let fd;
  try { fd = openSync(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Another native test owns ${lockPath}. Wait for it to close; if its recorded PID has exited, remove only this stale lock.`); throw error; }
  try { writeFileSync(fd, owner); } finally { closeSync(fd); }
  const release = () => {
    try { if (readFileSync(lockPath, 'utf8') === owner) unlinkSync(lockPath); } catch { /* Another owner must never be removed. */ }
    process.removeListener('exit', release);
  };
  process.once('exit', release);
  try {
    const application = await electron.launch({ ...options, executablePath: executable, env });
    application.once('close', release);
    return application;
  } catch (error) { release(); throw error; }
}
