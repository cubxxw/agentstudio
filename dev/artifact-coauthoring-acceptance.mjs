// Native acceptance. Default uses two explicit synthetic CLIs; --real uses the configured Codex/Pi.
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { cleanDesktopTestEnv } from './desktop-test-env.mjs';
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { _electron } = createRequire(requireDesktop.resolve('@playwright/test'))('playwright');
const { expect } = requireDesktop('@playwright/test');
const real = process.argv.includes('--real'), brokenPreview = process.argv.includes('--expect-preview-block');
if (real && brokenPreview) throw new Error('The failure fixture is synthetic only');
const root = resolve(process.env.AGENTROOM_EVIDENCE_DIR || 'output/artifact-coauthoring'); await mkdir(root, { recursive: true });
const output = await mkdtemp(join(root, real ? 'real-' : 'synthetic-'));
const env = cleanDesktopTestEnv({ ...process.env, AGENTSTUDIO_USER_DATA_DIR: join(output, 'profile'), AGENTSTUDIO_MOCK_KEYCHAIN: '1', AGENTSTUDIO_WORKSPACE: 'personal', AGENTSTUDIO_CLAUDE_BIN: '/agentroom-missing-claude' });
const checks = [], errors = []; let app, page, networkRequests = 0;
const sentinel = http.createServer((_req, res) => { networkRequests++; res.end('unexpected network'); }); await new Promise(resolve => sentinel.listen(0, '127.0.0.1', resolve));
const report = { realCLI: real, syntheticInputsOnly: true, output, checks, errors, status: 'running' };
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
if (!real) {
  const codexHome = join(output, 'codex-home'), piHome = join(output, 'pi-home'); await mkdir(codexHome); await mkdir(piHome);
  await writeFile(join(codexHome, 'config.toml'), 'model="synthetic-model"\nmodel_provider="synthetic"\nmodel_reasoning_effort="high"\n');
  await writeFile(join(piHome, 'settings.json'), JSON.stringify({ defaultProvider: 'synthetic', defaultModel: 'synthetic-model', defaultThinkingLevel: 'off' }));
  await writeFile(join(piHome, 'models.json'), JSON.stringify({ providers: { synthetic: { models: [{ id: 'synthetic-model', reasoning: false }] } } }));
  const driver = `#!${process.execPath}
import { basename } from 'node:path';
const breakPreview = ${JSON.stringify(brokenPreview)};
const pi = basename(process.argv[1]).includes('pi'), agent = pi ? 'pi' : 'codex', args=process.argv.slice(2);
const out = value => console.log(JSON.stringify(value));
if(args.includes('--version')) {console.log(agent+' 0.0.1-synthetic');process.exit(0)}
if(args[0]==='login'){console.log('Logged in');process.exit(0)}
if(args.includes('--help')){console.log('--no-builtin-tools --tools --extension');process.exit(0)}
if(args[0]==='features'){console.log('apps browser_use browser_use_external computer_use view_image shell_tool unified_exec multi_agent plugins remote_plugin in_app_browser');process.exit(0)}
if(args[0]==='mcp'){out([]);process.exit(0)}
if(args.includes('rpc')){out({id:'agentstudio-models',success:true,data:{models:[{provider:'synthetic',id:'synthetic-model',reasoning:false}]}});process.exit(0)}
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;let seq=0;
const call=async(name,arguments_={})=>{const response=await fetch(process.env.AGENTROOM_TOOL_ENDPOINT,{method:'POST',headers:{authorization:'Bearer '+process.env.AGENTROOM_TOOL_TOKEN,'content-type':'application/json'},body:JSON.stringify({name,arguments:arguments_,callId:agent+'-'+(++seq)})});const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value.result;};
const catalog=await (await fetch(process.env.AGENTROOM_TOOL_ENDPOINT,{headers:{authorization:'Bearer '+process.env.AGENTROOM_TOOL_TOKEN}})).json();
let text;
if(catalog.tools.some(t=>t.name==='creation_propose')){
 const visible=await call('artifact_list');await call('collaboration_status');
 await call('creation_propose',{title:'阅读空间',kind:'website',goal:'共同制作一个安静的阅读产品首页，保留设计选择。',task:pi?'梳理阅读场景与设计选择':'根据伙伴设计实现静态网页',writePaths:pi?['decisions.md']:['index.html'],dependsOnContacts:pi?[]:['agent_pi'],...(visible.artifacts[0]?{artifactId:visible.artifacts[0].id}:{})});
 text=JSON.stringify({action:'reply',text:pi?'我建议把阅读过程做得更安静，先明确一个核心场景。方案卡里我负责设计选择。':'我会把阅读的节奏做成一页轻巧的网页，接着 Pi 的设计继续实现。请审核共同方案。'});
}else{
 const status=await call('collaboration_status'), read=await call('artifact_read'), path=pi?'decisions.md':'index.html', previous=read.files.find(f=>f.path===path);
 let html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12vh 8vw;background:#f7f3eb;color:#243b33;font:18px/1.7 system-ui}small{letter-spacing:4px;color:#617d66}h1{font:500 clamp(40px,7vw,92px)/1.2 Georgia,serif;max-width:12em}p{max-width:32em}button{padding:14px 24px;border:0;border-radius:8px;background:#294c3f;color:white;font:inherit}</style><small>THE READING ROOM</small><h1>给想读的书，留一点安静。</h1><p>每天留一段属于自己的阅读时间。记下触动你的句子，慢慢读，也慢慢想。</p><button data-testid="reading-start" onclick="this.textContent=&quot;已留好今天的阅读时间&quot;">从一页开始</button><footer>'+(previous?'跨群继续修改，作品身份保持。':'由两位伙伴共同完成。')+'</footer></html>';
 if (breakPreview) html += '<script>throw new Error("Fixture preview failure")</script>';
 await call('artifact_write',{path,text:pi?'# 设计选择\\n\\n先服务一个阅读场景，保持低干扰。\\n'+(previous?'第二个群继续打磨同一作品。':'首轮设计。'):html,expectedHash:previous?.sha256||null});
 await call('artifact_submit',{summary:pi?'提交真实合成设计文件':'提交真实合成网页文件'});await call('task_complete',{summary:'本步骤已通过实际文件提交'});text='仅工作记录，不发布为群聊回复';
}
if(pi){out({type:'message_end',message:{role:'assistant',provider:'synthetic',model:'synthetic-model',stopReason:'stop',content:[{type:'text',text}]}});out({type:'agent_settled'});}else{out({type:'item.completed',item:{type:'agent_message',text}});out({type:'turn.completed'});}
`;
  for (const agent of ['codex', 'pi']) { const filename = join(output, `synthetic-${agent}.mjs`); await writeFile(filename, driver, { mode: 0o700 }); env[`AGENTSTUDIO_${agent.toUpperCase()}_BIN`] = filename; }
  env.CODEX_HOME = codexHome; env.PI_CODING_AGENT_DIR = piHome;
}
const request = async (path, body) => page.evaluate(async ({ path, body }) => {
  const response = await window.agentStudioPersonal.request({ path: `/api${path}`, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }) });
  if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.body)}`); return response.body;
}, { path, body });
const wait = async predicate => { let fatal; await expect.poll(async () => { try { return await predicate(); } catch (error) { fatal = error; return true; } }, { timeout: real ? 20 * 60000 : 30000, intervals: [100, 300, 1000] }).toBe(true); if (fatal) throw fatal; };
try {
  app = await _electron.launch({ executablePath: process.env.AGENTSTUDIO_ELECTRON_BINARY || requireDesktop('electron'), args: [resolve('apps/desktop')], env, timeout: 30000 });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1240, height: 850 }));
  await expect(page.getByTestId('im-app')).toBeVisible();
  await expect(page.getByTestId('im-nav-library')).toBeVisible({ timeout: 5000 }); check('independent library navigation');
  if (process.argv.includes('--ui-entry-only')) { report.status = 'passed'; }
  else {
    const discovered = (await request('/contacts')).contacts;
    for (const id of ['agent_codex', 'agent_pi']) { const contact = discovered.find(c => c.id === id); if (contact?.availability !== 'ready') throw new Error(`${id}: ${contact?.availability || 'not discovered'}`); }
    if (!real) {
      const rejected = await request('/chats', { kind: 'group', title: '拒绝不会执行', memberIds: ['agent_codex', 'agent_pi'], clientId: crypto.randomUUID() });
      await page.goto(`${page.url().split(/[?#]/)[0]}?thread=${rejected.id}`);
      await page.getByTestId('im-message-input').fill('@all 提议一个静态网页，先等我审核。'); await page.getByTestId('im-send').click();
      await wait(async () => (await request(`/threads/${rejected.id}/creation`)).proposals[0]?.state === 'ready');
      await page.getByTestId('creation-reject').click(); await expect(page.getByTestId('creation-card')).toContainText('暂不制作');
      expect((await request('/library/artifacts')).artifacts).toHaveLength(0); check('native reject keeps discussion without creating content');
    }
    const group = await request('/chats', { kind: 'group', title: real ? '真实 Codex + Pi 共创验收' : '共创验收 · 合成', memberIds: ['agent_codex', 'agent_pi'], clientId: crypto.randomUUID() });
    await page.goto(`${page.url().split(/[?#]/)[0]}?thread=${group.id}`);
    const send = async text => { await page.getByTestId('im-message-input').fill(text); await page.getByTestId('im-send').click(); };
    await send('@all 我想做一个安静的阅读产品首页。请各自回应、提出创意，再用工具加入同一张共创方案卡。Pi 负责 decisions.md 说明设计选择，Codex 负责 index.html 并依赖 Pi。作品是无外部依赖的静态网页，包含 brief 和设计说明。先出方案，等我审核。');
    let state;
    await wait(async () => { state = await request(`/threads/${group.id}/creation`); const thread = await request(`/threads/${group.id}`); if (thread.runs.some(run => ['blocked', 'unknown', 'failed'].includes(run.status))) throw new Error(JSON.stringify(thread.runs.map(({ localAgentId, status, error }) => ({ localAgentId, status, error })))); if (state.proposals[0]?.state === 'needs_input' && thread.runs.every(run => ['completed', 'blocked', 'cancelled'].includes(run.status))) throw new Error(`Shared plan needs input: ${state.proposals[0].error}`); return state.proposals[0]?.state === 'ready'; });
    expect(state.proposals).toHaveLength(1); expect(state.proposals[0].contributors).toHaveLength(2);
    expect((await request('/library/artifacts')).artifacts).toHaveLength(0);
    await expect(page.getByTestId('creation-card')).toHaveCount(1); if (!real) await expect(page.getByTestId('im-message')).toHaveCount(3); else expect((await request(`/threads/${group.id}`)).messages.filter(message => message.role === 'assistant').map(message => message.contactId).sort()).toEqual(['agent_codex', 'agent_pi']);
    await page.screenshot({ path: join(output, 'review-card.png') }); check('two separate replies and one native proposal, no content before approval');
    if (!real) {
      await page.getByTestId('creation-adjust').click(); await page.getByTestId('creation-edit-goal').fill('共同制作一个安静的阅读产品首页，保留设计选择，并适配窄屏。'); await page.getByTestId('creation-save').click();
      await expect(page.getByTestId('creation-card')).toContainText('并适配窄屏'); check('owner edits and reviews a new canonical proposal version');
    }
    await page.getByTestId('creation-approve').click();
    let work;
    await wait(async () => { state = await request(`/threads/${group.id}/creation`); work = state.collaborations[0]; if (brokenPreview && work?.status === 'blocked' && work.previewChecks) return true; if (['blocked', 'unknown', 'cancelled'].includes(work?.status)) throw new Error(JSON.stringify(work)); return work?.status === 'completed'; });
    if (brokenPreview) { expect(work.previewChecks.passed).toBe(false); expect(work.previewChecks.errors.join(' ')).toContain('Fixture preview failure'); check('native runtime errors block final delivery despite saved revisions'); report.status = 'passed'; } else {
    const artifactId = work.artifactId, firstRevision = work.finalRevisionId;
    const detail = await request(`/library/artifacts/${artifactId}`);
    expect(new Set(detail.contributions.filter(item => item.state === 'integrated').map(item => item.contactId))).toEqual(new Set(['self', 'agent_pi', 'agent_codex']));
    check('one approval produces two independently attributed tool contributions');
    await page.getByTestId('artifact-open').click(); await expect(page.getByTestId('artifact-workspace')).toBeVisible();
    await expect(page.getByTestId('artifact-preview')).toBeVisible();
    const frame = page.frameLocator('[data-testid="artifact-preview"]'); await expect(frame.locator('body')).toBeVisible(); if (!real) await expect(frame.getByTestId('reading-start')).toBeVisible();
    expect(await frame.locator('body').evaluate(() => typeof window.agentStudioPersonal)).toBe('undefined');
    expect(await frame.locator('body').evaluate(() => { try { void window.top.document.body; return false; } catch { return true; } })).toBe(true);
    const networkBlocked = await frame.locator('body').evaluate(async (_node, url) => { try { await fetch(url, { mode: 'no-cors' }); return false; } catch { return true; } }, `http://127.0.0.1:${sentinel.address().port}/preview-probe`); expect(networkBlocked).toBe(true); expect(networkRequests).toBe(0);
    if (!real) { await frame.getByTestId('reading-start').click(); await expect(frame.getByTestId('reading-start')).toContainText('已留好'); } else expect((await frame.locator('body').innerText()).length).toBeGreaterThan(60);
    await page.screenshot({ path: join(output, 'workspace.png') }); check('isolated native preview runs scripts without bridge or parent access');
    const second = await request('/chats', { kind: 'group', title: '第二个群 · 接着做', memberIds: ['agent_codex', 'agent_pi'], clientId: crypto.randomUUID() });
    await page.getByTestId('artifact-share').click(); await page.getByTestId('artifact-share-thread').selectOption(second.id); await page.getByTestId('artifact-share-confirm').click();
    await expect(page.getByTestId('artifact-share-notice')).toContainText('已共享');
    await page.goto(`${page.url().split(/[?#]/)[0]}?thread=${second.id}`);
    await send('@all 接着已共享的同一件作品修改。请两位都回应并用工具加入新一轮方案；Pi 改进 decisions.md，Codex 依赖 Pi 修改 index.html，加上跨群继续创作的说明。保持同一 artifactId，先给我审核卡。');
    await wait(async () => { state = await request(`/threads/${second.id}/creation`); return state.proposals[0]?.state === 'ready'; });
    expect(state.proposals[0].artifactId).toBe(artifactId); await page.getByTestId('creation-approve').click();
    await wait(async () => { state = await request(`/threads/${second.id}/creation`); work = state.collaborations[0]; if (['blocked', 'unknown'].includes(work?.status)) throw new Error(JSON.stringify(work)); return work?.status === 'completed'; });
    expect(work.artifactId).toBe(artifactId); expect(work.finalRevisionId).not.toBe(firstRevision);
    check('second group creates a new version of the same persistent artifact');
    await page.getByTestId('artifact-open').click(); await page.getByTestId('artifact-tab-history').click();
    await expect(page.getByTestId('artifact-revision')).toHaveCount(5);
    await page.reload(); await page.getByTestId('im-nav-library').click(); await page.getByTestId(`library-artifact-${artifactId}`).click();
    await expect(page.getByTestId('artifact-workspace')).toBeVisible(); check('library reopens the artifact independently of either conversation');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 640, height: 780 })); await page.screenshot({ path: join(output, 'narrow-workspace.png') });
    report.artifactId = artifactId; report.firstRevision = firstRevision; report.finalRevision = work.finalRevisionId; report.contributors = detail.contributions.map(({ contactId, runId, revisionId }) => ({ contactId, runId, revisionId })); report.status = 'passed';
    }
  }
} catch (error) { report.status = 'failed'; report.error = error.message; if (page) { try { const library = await request('/library/artifacts'); report.savedArtifactCount = library.artifacts.length; } catch {} } process.exitCode = 1; if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); }
finally { if (app) await app.close(); await new Promise(resolve => sentinel.close(resolve)); await writeFile(join(output, 'acceptance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, status: report.status, checks, error: report.error })); }
