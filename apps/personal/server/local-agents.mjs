import { spawn as nativeSpawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

// Server-only adapters. Never pass renderer input into deps, commands or env.
// Auth status means local login configuration, not account ownership or quota.
// Claude flags/auth JSON: https://code.claude.com/docs/en/cli-reference
// --safe-mode keeps authentication/model selection while disabling customizations.
const CATALOG = Object.freeze([
  { id: 'codex', name: 'Codex', setupUrl: 'https://developers.openai.com/codex/cli/', loginCommandId: 'codex-login' },
  { id: 'claude', name: 'Claude Code', setupUrl: 'https://code.claude.com/docs/en/setup', loginCommandId: 'claude-login' },
  { id: 'pi', name: 'Pi', setupUrl: 'https://pi.dev/', loginCommandId: null },
  { id: 'gemini', name: 'Gemini CLI', setupUrl: 'https://geminicli.com/docs/get-started/installation/', loginCommandId: null },
  { id: 'opencode', name: 'OpenCode', setupUrl: 'https://opencode.ai/docs/', loginCommandId: null },
]);
export const LOCAL_AGENT_IDS = Object.freeze(CATALOG.map(({ id }) => id));
const AUTH_METHODS = new Set(['none', 'claude.ai', 'oauth_token', 'api_key', 'api_key_helper', 'third_party']);
const MESSAGES = Object.freeze({
  unknown_agent: '不支持这个本机助手标识。',
  invalid_input: '本机助手需要非空提示词和有效的独立工作目录。',
  not_installed: '没有找到这个本机助手。请按官方说明安装后重新检查。',
  authentication_required: '这个本机助手尚未登录，请在本机完成登录后重新检查。',
  authentication_unknown: '尚不能确认这个本机助手的登录配置，请在本机检查后重试。',
  execution_unsupported: '已识别这个助手，但本版本尚未支持可靠的受控执行；没有调用模型。',
  unsupported_cli_version: '当前 CLI 缺少受控执行所需选项，请更新官方 CLI 后重新检查；没有调用模型。',
  cancelled: '本次本机助手执行已取消。',
  timeout: '本机助手超过运行时限，结果未确认；没有切换模型或提供商。',
  output_limit: '本机助手输出超过上限，结果未确认。',
  spawn_failed: '本机助手无法启动，请检查本机安装与执行权限。',
  stop_unconfirmed: '本机助手停止尚未确认，请核查本次本机进程；未保存成功结果。',
  provider_limit: '当前助手的提供商额度或速率限制阻止了执行；没有切换提供商。',
  execution_failed: '本机助手没有返回成功的结构化文档结果，请核查 CLI 登录与配置。',
});
export class LocalAgentError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.execution_failed);
    this.name = 'LocalAgentError'; this.code = Object.hasOwn(MESSAGES, code) ? code : 'execution_failed';
    this.status = ['unknown_agent', 'invalid_input'].includes(this.code) ? 400 : 503;
  }
}
const supported = (id) => id === 'codex' || id === 'claude';
const definition = (id) => {
  const agent = CATALOG.find((item) => item.id === id);
  if (!agent) throw new LocalAgentError('unknown_agent');
  return agent;
};
const limit = (value, fallback, maximum) => Number.isFinite(value) && value > 0 ? Math.min(value, maximum) : fallback;
function options(deps) {
  return { ...deps, spawn: deps.spawn || nativeSpawn, env: deps.env || process.env, home: deps.home ?? homedir(),
    now: deps.now || Date.now,
    probeTimeoutMs: limit(deps.probeTimeoutMs, 2500, 10_000),
    executionTimeoutMs: limit(deps.executionTimeoutMs, 300_000, 600_000),
    maxProbeBytes: limit(deps.maxProbeBytes, 16_384, 65_536),
    maxOutputBytes: limit(deps.maxOutputBytes, 2_000_000, 4_000_000),
    killGraceMs: limit(deps.killGraceMs, 300, 1500),
    cacheTtlMs: limit(deps.cacheTtlMs, 15_000, 60_000) };
}

async function executableFor(agent, deps) {
  // An explicit server command override is authoritative, including a missing
  // test command: never fall back to the user's working CLI in that case.
  const command = Object.hasOwn(deps.commands || {}, agent.id) ? deps.commands[agent.id] : agent.id;
  if (typeof command !== 'string' || !command || command.includes('\0')) return null;
  const directories = [...new Set([...(deps.env.PATH || '').split(delimiter).filter(isAbsolute),
    join(deps.home, '.local/bin'), join(deps.home, 'bin'), join(deps.home, 'Library/pnpm'),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])];
  const candidates = command.includes('/') || command.includes('\\') ? [resolve(command)] : directories.map((directory) => join(directory, command));
  for (const path of candidates) {
    try { await access(path, constants.X_OK); if ((await stat(path)).isFile()) return path; }
    catch { /* A missing/inaccessible candidate cannot supply an executable. */ }
  }
  return null;
}

// Private bounded capture; only parsed whitelisted values leave this module.
function run(command, args, deps, { cwd, input = '', signal, probe = false } = {}) {
  if (signal?.aborted) return Promise.reject(new LocalAgentError('cancelled'));
  return new Promise((resolveRun, reject) => {
    let child, deadline, escalation, reaping, closed = false, failure = null;
    let stdoutBytes = 0, stderrBytes = 0;
    const stdout = [], stderr = [], cap = probe ? deps.maxProbeBytes : deps.maxOutputBytes;
    const cleanup = () => {
      clearTimeout(deadline); clearTimeout(escalation); clearTimeout(reaping);
      signal?.removeEventListener('abort', abort);
    };
    const finish = (code) => {
      if (closed) return;
      closed = true; cleanup();
      if (failure) reject(new LocalAgentError(failure));
      else resolveRun({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    };
    const kill = (kind) => {
      if (!child || closed) return;
      try {
        if (child.pid && process.platform !== 'win32') (deps.kill || process.kill)(-child.pid, kind);
        else child.kill(kind);
      } catch { try { child.kill(kind); } catch { /* Only this owned child may be signaled. */ } }
    };
    const stop = (reason) => {
      if (closed || failure) return;
      failure = reason;
      kill('SIGTERM');
      if (closed) return;
      escalation = setTimeout(() => {
        kill('SIGKILL');
        if (!closed) reaping = setTimeout(() => { failure = 'stop_unconfirmed'; finish(null); }, 1000);
      }, deps.killGraceMs);
    };
    const abort = () => stop('cancelled');
    try {
      child = deps.spawn(command, args, { cwd, env: deps.env, shell: false, detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch { failure = 'spawn_failed'; finish(null); return; }
    child.once('error', () => { failure ||= 'spawn_failed'; });
    child.once('close', finish);
    child.stdout.on('data', (chunk) => {
      if (closed || failure) return;
      const bytes = Buffer.from(chunk); stdoutBytes += bytes.length;
      if (stdoutBytes + (probe ? stderrBytes : 0) > cap) { stop('output_limit'); return; }
      stdout.push(bytes);
    });
    child.stderr.on('data', (chunk) => {
      if (closed || failure) return;
      const bytes = Buffer.from(chunk);
      if (probe) {
        stderrBytes += bytes.length;
        if (stdoutBytes + stderrBytes > cap) { stop('output_limit'); return; }
        stderr.push(bytes);
      } else if (stderrBytes < 16_384) {
        const bounded = bytes.subarray(0, 16_384 - stderrBytes); stderrBytes += bounded.length; stderr.push(bounded);
      }
    });
    child.stdin.on('error', () => {});
    signal?.addEventListener('abort', abort, { once: true });
    deadline = setTimeout(() => stop('timeout'), probe ? deps.probeTimeoutMs : deps.executionTimeoutMs);
    child.stdin.end(input);
    if (signal?.aborted) abort();
  });
}

const versionOf = (text) => text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,4}\b/)?.[0] || null;
async function probe(command, args, deps, signal) {
  try { return await run(command, args, deps, { probe: true, signal, cwd: deps.home }); }
  catch (error) { if (error.code === 'cancelled') throw error; return null; }
}
async function authentication(agent, command, deps, signal) {
  if (!supported(agent.id)) return { status: 'unsupported' };
  const result = await probe(command, agent.id === 'codex' ? ['login', 'status'] : ['auth', 'status'], deps, signal);
  if (!result) return { status: 'unknown' };
  if (agent.id === 'codex') {
    if (result.code === 0) return { status: 'configured' };
    return { status: result.code === 1 && /not logged in|logged out|not authenticated/i.test(result.stdout + result.stderr) ? 'required' : 'unknown' };
  }
  try {
    const auth = JSON.parse(result.stdout);
    const method = AUTH_METHODS.has(auth?.authMethod) ? { method: auth.authMethod } : {};
    if (auth?.loggedIn === true && result.code === 0) return { status: 'configured', ...method };
    if (auth?.loggedIn === false && [0, 1].includes(result.code)) return { status: 'required', ...method };
  } catch { /* Malformed or unexpected auth data remains unknown, never raw text. */ }
  return { status: 'unknown' };
}

const caches = new WeakMap();
export async function discoverLocalAgents({ force = false, deps: injected = {} } = {}) {
  const deps = options(injected);
  let cache = caches.get(deps.spawn);
  if (!cache) { cache = new Map(); caches.set(deps.spawn, cache); }
  const key = JSON.stringify([deps.home, deps.env.PATH || '', LOCAL_AGENT_IDS.map((id) => deps.commands?.[id] ?? null)]);
  const previous = cache.get(key);
  if (previous?.pending) return structuredClone(await previous.pending);
  if (!force && previous && previous.expires > deps.now()) return structuredClone(previous.value);
  const entry = {};
  cache.set(key, entry);
  const pending = (async () => {
    const agents = Array(CATALOG.length); let cursor = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (cursor < CATALOG.length) {
        const index = cursor++, agent = CATALOG[index], command = await executableFor(agent, deps);
        const version = command ? await probe(command, ['--version'], deps) : null;
        agents[index] = { ...agent, installed: Boolean(command), version: version?.code === 0 ? versionOf(version.stdout + version.stderr) : null,
          auth: command ? await authentication(agent, command, deps) : { status: 'required' },
          execution: { supported: supported(agent.id), ...(!supported(agent.id) ? { reason: MESSAGES.execution_unsupported } : {}) } };
      }
    }));
    const value = { checkedAt: new Date(deps.now()).toISOString(), agents };
    entry.value = value; entry.expires = deps.now() + deps.cacheTtlMs;
    return value;
  })();
  entry.pending = pending;
  try { return structuredClone(await pending); }
  finally {
    delete entry.pending;
    if (!entry.value) cache.delete(key);
    if (cache.size > 16) for (const [oldKey, item] of cache) if (oldKey !== key && !item.pending) { cache.delete(oldKey); break; }
  }
}

function finalMarkdown(id, result) {
  if (result.code !== 0) {
    if (/quota|usage.limit|insufficient|billing|credits|rate.limit|429/i.test(result.stderr + result.stdout)) throw new LocalAgentError('provider_limit');
    throw new LocalAgentError('execution_failed');
  }
  if (id === 'claude') {
    try {
      const event = JSON.parse(result.stdout);
      if (event?.type === 'result' && event.subtype === 'success' && event.is_error === false && typeof event.result === 'string' && event.result.trim()) return event.result;
    } catch { /* Only the successful result event is a document. */ }
  } else {
    let markdown = '', completed = false, failed = false;
    for (const line of result.stdout.split('\n')) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') markdown = event.item.text;
      if (event.type === 'turn.completed') completed = true;
      if (event.type === 'turn.failed' || event.type === 'error') failed = true;
    }
    if (completed && !failed && markdown.trim()) return markdown;
  }
  throw new LocalAgentError('execution_failed');
}

export async function executeLocalAgent({ id, prompt, workspace, signal, onEvent, deps: injected = {} } = {}) {
  const agent = definition(id), deps = options(injected);
  if (signal?.aborted) throw new LocalAgentError('cancelled');
  if (!supported(id)) throw new LocalAgentError('execution_unsupported');
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 2_000_000 || typeof workspace !== 'string' || !isAbsolute(workspace)) throw new LocalAgentError('invalid_input');
  try { if (!(await stat(workspace)).isDirectory()) throw new Error(); }
  catch { throw new LocalAgentError('invalid_input'); }
  const command = await executableFor(agent, deps);
  if (!command) throw new LocalAgentError('not_installed');
  const auth = await authentication(agent, command, deps, signal);
  if (auth.status !== 'configured') throw new LocalAgentError(auth.status === 'required' ? 'authentication_required' : 'authentication_unknown');
  const version = await probe(command, ['--version'], deps, signal);
  let args;
  if (id === 'codex') args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', workspace, '-'];
  else {
    const help = await probe(command, ['--help'], { ...deps, maxProbeBytes: 65_536 }, signal);
    const flags = ['--safe-mode', '--print', '--input-format', '--output-format', '--tools', '--strict-mcp-config', '--mcp-config',
      '--disallowedTools', '--permission-mode', '--disable-slash-commands', '--no-session-persistence', '--settings'];
    if (!help || help.code !== 0 || flags.some((flag) => !help.stdout.includes(flag))) throw new LocalAgentError('unsupported_cli_version');
    args = ['--safe-mode', '--print', '--input-format', 'text', '--output-format', 'json', '--tools', '',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disallowedTools', 'mcp__*',
      '--permission-mode', 'plan', '--disable-slash-commands', '--no-session-persistence', '--settings', '{"disableAllHooks":true}'];
  }
  const identity = { id, name: agent.name, version: version?.code === 0 ? versionOf(version.stdout + version.stderr) : null,
    authentication: 'configured', ...(auth.method ? { authMethod: auth.method } : {}) };
  const emit = (type) => { try { onEvent?.({ type, agentId: id }); } catch { /* Observer failures do not change execution. */ } };
  emit('started');
  const result = await run(command, args, deps, { cwd: workspace, input: prompt, signal });
  const markdown = finalMarkdown(id, result);
  emit('completed');
  return { markdown, identity, verification: { scope: 'cli_document_output', externalEffectsVerified: false } };
}
