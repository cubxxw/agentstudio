// Explicit real CLI probe. Only synthetic input; never print session credentials.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { ToolSessions } from '../apps/personal/server/tool-sessions.mjs';
import { executeLocalAgent } from '../apps/personal/server/local-agents.mjs';

if (!process.argv.includes('--real')) throw new Error('Use --real to run the configured Codex and Pi accounts.');
const output = resolve(process.env.AGENTROOM_EVIDENCE_DIR || 'output/artifact-tools-real');
await mkdir(output, { recursive: true });
const broker = new ToolSessions(); await broker.listen();
const outcomes = [];
try {
  const selected = process.argv.includes('--agent') ? [process.argv[process.argv.indexOf('--agent') + 1]] : ['codex', 'pi'];
  if (selected.some(x => !['codex', 'pi'].includes(x))) throw new Error('Unsupported probe agent');
  for (const agent of selected) {
    const workspace = join(output, `${agent}-workspace`); await mkdir(workspace, { recursive: true });
    const calls = [];
    const session = broker.open({ contactId: agent, runId: `real-probe-${agent}` }, [{ name: 'artifact_probe', description: 'Read the synthetic AgentRoom integration probe. Call once with empty arguments.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }], async (context, name, args, callId) => {
      calls.push({ actor: context.contactId, name, callId, emptyArguments: Object.keys(args).length === 0 });
      return { value: `AGENTROOM_${agent.toUpperCase()}_REAL_TOOL_OK` };
    });
    const diagnostic = { flags: [], eventTypes: [], exitCode: null, configurationErrors: [] };
    const flags = { unknownOption: /unexpected argument|unknown (?:feature|field|variant)|invalid value/i, configuration: /config/i, plugin: /plugin/i, mcp: /mcp/i, serverStartup: /startup|spawn|starting/i, unauthenticated: /401|403|unauthori[sz]ed|authentication/i, provider: /provider/i, network: /network|connection|stream disconnected/i, sandbox: /sandbox|operation not permitted/i };
    const deps = { spawn(command, args, options) {
      const child = spawn(command, args, options);
      if (args[0] === 'exec' || args.includes('--print')) {
        const inspect = chunk => { const text = String(chunk); for (const [name, pattern] of Object.entries(flags)) if (pattern.test(text) && !diagnostic.flags.includes(name)) diagnostic.flags.push(name); for (const match of text.matchAll(/"type"\s*:\s*"([a-z_.-]{1,70})"/g)) if (!diagnostic.eventTypes.includes(match[1])) diagnostic.eventTypes.push(match[1]); for (const line of text.split('\n')) if (/^(?:Error loading config|error: (?:invalid|missing|unknown)|missing field|invalid type)/i.test(line.trim())) diagnostic.configurationErrors.push(line.replace(/https?:\/\/\S+/g, '<url>').replace(/"[^"\n]*"/g, '"<value>"').replace(/[A-Za-z0-9_+\/-]{30,}/g, '<opaque>').slice(0, 500)); };
        child.stdout.on('data', inspect); child.stderr.on('data', inspect); child.once('close', code => { diagnostic.exitCode = code; });
      }
      return child;
    } };
    try {
      const result = await executeLocalAgent({ id: agent, prompt: 'This is an owner-authorized synthetic integration probe. Use only the artifact_probe tool exactly once with empty arguments. Then reply with the returned value, without explanation. Do not read files or use other tools.', workspace, toolSession: session, deps });
      outcomes.push({ agent, identity: result.identity, status: calls.length === 1 && result.markdown.includes(`AGENTROOM_${agent.toUpperCase()}_REAL_TOOL_OK`) ? 'passed' : 'failed', calls, answer: result.markdown, diagnostic });
    } catch (error) { outcomes.push({ agent, status: 'failed', code: error.code || error.name, message: error.message, calls, diagnostic }); }
    finally { session.close(); }
    await writeFile(join(output, 'native-tools.json'), JSON.stringify({ realCLI: true, syntheticInputsOnly: true, outcomes }, null, 2));
  }
} finally { await broker.close(); }
console.log(JSON.stringify({ output, outcomes }));
if (outcomes.some(x => x.status !== 'passed')) process.exitCode = 1;
