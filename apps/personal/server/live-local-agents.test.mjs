import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { executeLocalAgent, discoverLocalAgents } from './local-agents.mjs';

async function fixture(t, mode = 'success') {
  const home = await mkdtemp(join(tmpdir(), 'live-pi-')); t.after(() => rm(home, { recursive: true, force: true }));
  const command = join(home, 'pi'), trace = join(home, 'trace.json'), work = join(home, 'work'); await mkdir(work);
  await mkdir(join(home, '.pi/agent'), { recursive: true });
  const settings = model => writeFile(join(home, '.pi/agent/settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: model, defaultThinkingLevel: 'high' }));
  await settings('model-a');
  await writeFile(command, `
const fs=require('node:fs');const args=process.argv.slice(2);const write=x=>process.stdout.write(JSON.stringify(x)+'\\n');
if(args.includes('--version'))console.log('pi 0.85.1');
else if(args.includes('rpc')){process.stdin.setEncoding('utf8');process.stdin.on('data',line=>{const c=JSON.parse(line);write({id:c.id,success:true,data:{models:['model-a','model-b',...(${JSON.stringify(mode)}==='catalog'?Array.from({length:500},(_,i)=>'catalog-'+i):[])].map(id=>({provider:'fixture',id,reasoning:true,headers:{Authorization:'SYNTHETIC_SECRET'},transportPadding:'x'.repeat(${mode === 'catalog' ? 500 : 0}),thinkingLevelMap:{minimal:null,xhigh:'high'}}))}});});}
else { let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>prompt+=x);process.stdin.on('end',()=>{
fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify({args,prompt}));write({type:'agent_start'});write({type:'message_start',message:{role:'assistant'}});
const bytes=Buffer.from(JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'hello 🌿'}})+'\\n');const at=bytes.indexOf(Buffer.from('🌿'))+1;process.stdout.write(bytes.subarray(0,at));
setTimeout(()=>{process.stdout.write(bytes.subarray(at));write({type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'PRIVATE_REASONING_NOT_FOR_UI'}});},20);
setTimeout(()=>{write({type:'message_end',message:{role:'assistant',provider:'fixture',model:'model-a',stopReason:${JSON.stringify(['error', 'auth'].includes(mode) ? 'error' : 'stop')},errorMessage:${JSON.stringify(mode === 'auth' ? '401 Invalid API Key SYNTHETIC_PRIVATE_VALUE' : '')},content:[{type:'text',text:'authoritative final reply'}]}});write({type:'agent_end'});write({type:'agent_settled'});},90);
}); }
`, { mode: 0o700 });
  const deps = { home, env: { ...process.env, PATH: '/usr/bin:/bin' }, commands: { pi: command, codex: '/missing-codex', claude: '/missing-claude', gemini: '/missing-gemini', opencode: '/missing-opencode' }, spawn: (cmd, args, options) => spawn(process.execPath, [cmd, ...args], options) };
  return { home, trace, work, deps, settings };
}

test('Pi emits actual UTF-8 progress before completion and pins model/thinking with no tools or extensions', async t => {
  const f = await fixture(t); const events = []; let finished = false;
  const result = await executeLocalAgent({ id: 'pi', prompt: 'synthetic only', workspace: f.work, deps: f.deps,
    executionSnapshot: { agentId: 'pi', provider: 'fixture', model: 'model-a', thinking: 'high' },
    onEvent: event => { events.push(event); if (event.text) assert.equal(finished, false); } });
  finished = true;
  assert.equal(result.markdown, 'authoritative final reply');
  assert.ok(events.some(event => event.text === 'hello 🌿'));
  assert.ok(!JSON.stringify(events).includes('PRIVATE_REASONING_NOT_FOR_UI'));
  const { args } = JSON.parse(await readFile(f.trace, 'utf8'));
  for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-session', '--no-context-files', '--no-approve', '--offline']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--provider') + 1], 'fixture');
  assert.equal(args[args.indexOf('--model') + 1], 'model-a');
  assert.equal(args[args.indexOf('--thinking') + 1], 'high');
  assert.ok(args[args.indexOf('--system-prompt') + 1].startsWith('You are an AgentStudio'));
  assert.equal(args[args.indexOf('--append-system-prompt') + 1], '');
});

test('Pi JSON error with exit code zero never becomes a successful answer', async t => {
  const f = await fixture(t, 'error');
  await assert.rejects(executeLocalAgent({ id: 'pi', prompt: 'synthetic only', workspace: f.work, deps: f.deps,
    executionSnapshot: { agentId: 'pi', provider: 'fixture', model: 'model-a', thinking: 'high' } }), error => error.code === 'execution_failed');
});

test('Pi provider authentication failure is actionable without exposing its raw response', async t => {
  const f = await fixture(t, 'auth');
  await assert.rejects(executeLocalAgent({ id: 'pi', prompt: 'synthetic only', workspace: f.work, deps: f.deps,
    executionSnapshot: { agentId: 'pi', provider: 'fixture', model: 'model-a', thinking: 'high' } }), error => error.code === 'provider_authentication_failed' && !error.message.includes('SYNTHETIC_PRIVATE_VALUE'));
});

test('discovery immediately observes a changed Pi default without restarting the server', async t => {
  const f = await fixture(t);
  const first = (await discoverLocalAgents({ deps: f.deps })).agents.find(a => a.id === 'pi');
  assert.equal(first.profile.defaults.model, 'model-a'); assert.equal(first.execution.supported, true);
  await f.settings('model-b');
  const next = (await discoverLocalAgents({ deps: f.deps })).agents.find(a => a.id === 'pi');
  assert.equal(next.profile.defaults.model, 'model-b');
  assert.deepEqual(next.profile.models[0].thinkingLevels, ['off', 'low', 'medium', 'high', 'xhigh']);
  assert.ok(!JSON.stringify(next).includes('SYNTHETIC_SECRET'));
  assert.ok(!JSON.stringify(next).includes('Authorization'));
});

test('Pi metadata supports a large provider catalog without exporting transport configuration', async t => {
  const f = await fixture(t, 'catalog');
  const pi = (await discoverLocalAgents({ deps: f.deps })).agents.find(agent => agent.id === 'pi');
  assert.equal(pi.auth.status, 'configured'); assert.equal(pi.profile.models.length, 502);
  assert.ok(!JSON.stringify(pi).includes('SYNTHETIC_SECRET')); assert.ok(!JSON.stringify(pi).includes('transportPadding'));
});
