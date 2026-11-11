import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ToolSessions } from './tool-sessions.mjs';
import { executeLocalAgent } from './local-agents.mjs';

test('installed Pi runs the scoped extension through a synthetic provider tool loop', { skip: !process.env.AGENTROOM_TEST_PI_BIN, timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agentroom-native-pi-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = requests.length === 1 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'synthetic-tool-call', type: 'function', function: { name: 'artifact_probe', arguments: '{}' } }] } : { content: 'SYNTHETIC_TOOL_LOOP_OK' };
    const frame = (delta, finish_reason) => `data: ${JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'synthetic-tool-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    response.end(frame(delta, null) + frame({}, requests.length === 1 ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const agentDir = join(directory, '.pi/agent'); await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'synthetic', defaultModel: 'synthetic-tool-model', defaultThinkingLevel: 'off' }));
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { synthetic: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'synthetic-fixture-only', models: [{ id: 'synthetic-tool-model', name: 'Synthetic tool transport', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16384, maxTokens: 1024 }] } } }));
  const broker = new ToolSessions(); await broker.listen(); t.after(() => broker.close());
  const calls = [];
  const session = broker.open({ contactId: 'synthetic-pi', runId: 'native-extension-check' }, [{ name: 'artifact_probe', description: 'Read the synthetic probe.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }], async context => { calls.push(context.contactId); return { value: 'ACTUAL_BROKER_RESULT' }; });
  let stderr = '';
  const result = await executeLocalAgent({ id: 'pi', prompt: 'Call the provided tool.', workspace: directory, toolSession: session,
    deps: { home: directory, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, commands: { pi: process.env.AGENTROOM_TEST_PI_BIN }, probeTimeoutMs: 10000,
      spawn(command, args, options) { const child = spawn(command, args, options); if (args.includes('--print')) child.stderr.on('data', chunk => { stderr += chunk; }); return child; } } });
  assert.equal(result.markdown, 'SYNTHETIC_TOOL_LOOP_OK');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].tools?.map(tool => tool.function.name), ['artifact_probe'], stderr);
  assert.deepEqual(calls, ['synthetic-pi'], JSON.stringify(requests[1].messages.filter(message => message.role === 'tool')));
  assert.ok(requests[1].messages.some(message => message.role === 'tool' && message.content.includes('ACTUAL_BROKER_RESULT')));
});
