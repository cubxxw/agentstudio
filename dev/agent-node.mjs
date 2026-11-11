#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createAgentNode, nodePublicURL } from '../apps/personal/server/agent-node.mjs';

const [command, ...args] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--state', '--name', '--agents', '--public-url', '--port'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown option; run with help');
  flags[args[i].slice(2)] = args[i + 1];
}
const state = resolve(flags.state || join(homedir(), '.local/share/agentroom-node'));
const configPath = join(state, 'config.json'), tokenPath = join(state, 'access-token');
if (command === 'init') {
  const publicUrl = nodePublicURL(flags['public-url']);
  const agents = (flags.agents || 'codex').split(',');
  const port = Number(flags.port || 18749);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || agents.some(a => !['codex', 'claude', 'pi'].includes(a)) || new Set(agents).size !== agents.length) throw new Error('Invalid port or agents');
  mkdirSync(state, { recursive: true, mode: 0o700 }); chmodSync(state, 0o700);
  // Exclusive creation: never replace a live node's identity or credential.
  writeFileSync(configPath, JSON.stringify({ name: flags.name || hostname(), agents, publicUrl, port }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  writeFileSync(tokenPath, randomBytes(32).toString('base64url') + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Node initialized at ${state}\nPrivate token file: ${tokenPath}\nRun: node dev/agent-node.mjs serve --state ${state}\nTailscale Serve: add a free HTTPS listener proxying http://127.0.0.1:${port}\nAdd server address in AgentRoom: ${publicUrl}`);
} else if (command === 'serve') {
  if (Object.keys(flags).some(k => k !== 'state')) throw new Error('serve accepts only --state; edit private config for local policy');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const node = await createAgentNode({ ...config, dataDir: state, token: readFileSync(tokenPath, 'utf8').trim() });
  await node.listen(); console.log(`AgentRoom node ${node.nodeId} listening on loopback port ${config.port}`);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void node.close().then(() => { process.exitCode = 0; }); });
} else {
  console.log('AgentRoom server node (Node >=22.13)\n\ninit --public-url https://server.tailnet.ts.net [--name Server] [--agents codex,claude,pi] [--port 18749] [--state PATH]\nserve [--state PATH]\n\nOnly explicitly enabled agents run; uses this server\'s existing CLI login. Protect the token file. No desktop data is copied.');
  if (command && !['help', '--help'].includes(command)) process.exitCode = 1;
}
