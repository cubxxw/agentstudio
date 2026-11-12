import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { createPersonalServer } from '../apps/personal/server/index.mjs';

// Browser plugin not available. Use the repository's existing Playwright package
// with isolated browser contexts and synthetic data; no user browser profile.
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const evidence = process.env.AGENTROOM_EVIDENCE_DIR;
if (!evidence) throw new Error('Set AGENTROOM_EVIDENCE_DIR to a managed artifact directory');
await mkdir(join(evidence, 'screenshots'), { recursive: true });
const profile = { agentId: 'codex', version: 'synthetic', defaults: { provider: 'fixture', model: 'fixture', thinking: 'medium' }, thinkingLevels: ['medium'], providers: ['fixture'], models: [{ provider: 'fixture', id: 'fixture', reasoning: true, thinkingLevels: ['medium'] }] };
const host = await createPersonalServer({ dataDir: join(evidence, `browser-workspace-${Date.now()}`), port: 0, staticDir: resolve(evidence, 'ui'), codexCommand: '/missing-synthetic-codex',
  discoverLocalAgents: async () => ({ agents: [{ id: 'codex', name: '合成验收分身', installed: true, version: 'fixture', auth: { status: 'configured' }, execution: { supported: true }, profile }] }),
  playExecute: async context => `合成验收回复：${context.messages.at(-1).text}`,
});
await host.listen();
host.store.put('setting', { id: 'workspace-onboarding', completed: true });
const origin = `http://127.0.0.1:${host.address().port}`;
const browser = await chromium.launch({ headless: true }); const errors = [];
const owner = await browser.newPage({ viewport: { width: 1280, height: 900 } });
owner.on('pageerror', error => errors.push(error.message));
let verdict = 'failed';
try {
  await owner.goto(origin); await owner.getByTestId('im-playrooms-open').click({ timeout: 5000 });
  await owner.getByTestId('play-gallery').screenshot({ path: join(evidence, 'screenshots', 'play-gallery.png') });
  for (const template of ['travel', 'twin', 'project']) {
    await owner.getByTestId(`play-case-${template}`).click();
    await expect(owner.getByTestId('play-brief')).not.toHaveValue('');
    await owner.getByTestId('play-title').fill(`合成验收｜${template}`);
    await owner.getByTestId('play-agent').selectOption('agent_codex');
    await owner.getByTestId('play-create').click();
    await expect(owner.getByTestId('play-room')).toBeVisible();
    const room = host.store.list('play_room')[0]; const invite = await (await fetch(`${origin}/api/playrooms/${room.id}/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    const aContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const bContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const a = await aContext.newPage(), b = await bContext.newPage();
    for (const [page, name] of [[a, room.hostName], [b, '乙']]) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(invite.localUrl); await expect(page.getByTestId('play-invitation')).toBeVisible();
      if (page === a) await page.screenshot({ path: join(evidence, 'screenshots', `${template}-invitation.png`), fullPage: true });
      await page.getByTestId('play-nickname').fill(name); await page.getByTestId('play-join').click();
      await expect(page.getByTestId('play-room')).toBeVisible();
    }
    await a.getByTestId('play-message').fill('一起想一个好玩的开场'); await a.getByTestId('play-send').click();
    await expect(b.getByTestId('play-messages')).toContainText('合成验收回复：一起想一个好玩的开场');
    const identity = await a.evaluate(() => fetch(location.pathname.replace('/g/', '/g-api/')).then(r => r.json()).then(r => r.me.id));
    await a.goto('about:blank'); await a.goto(invite.localUrl); await expect(a.getByTestId('play-room')).toBeVisible();
    assert.equal(await a.evaluate(() => fetch(location.pathname.replace('/g/', '/g-api/')).then(r => r.json()).then(r => r.me.id)), identity, 'Original invitation must resume the existing seat');
    host.playrooms.action(room.id, 'self', { type: 'message', text: '主人在这里', clientId: crypto.randomUUID() });
    await expect(b.getByTestId('play-message-role-owner')).toHaveText('主人');
    await expect(b.getByTestId('play-message-role-guest').first()).toHaveText('访客');
    if (template === 'twin') {
      let release;
      await a.route(`**/g-api/${room.id}/actions`, async route => {
        if (route.request().postDataJSON().type !== 'message') return route.continue();
        const response = await route.fetch(); await new Promise(resolve => { release = async () => { await route.fulfill({ response }); resolve(); }; });
      });
      await a.getByTestId('play-message').fill('已发送的第一句'); await a.getByTestId('play-send').click();
      await expect.poll(() => Boolean(release)).toBe(true); await a.getByTestId('play-message').fill('等待时写下的下一句'); await release();
      await expect(a.getByTestId('play-message')).toHaveValue('等待时写下的下一句'); await a.unroute(`**/g-api/${room.id}/actions`);
    }
    if (template === 'travel') {
      await a.getByTestId('play-vote-choice_0').click();
      await b.getByTestId('play-tab-plan').click();
      await expect(b.getByTestId('play-votes-choice_0')).toHaveText('1');
    } else await b.getByTestId('play-tab-plan').click();
    await a.getByTestId('play-task-task_0').check(); await expect(b.getByTestId('play-task-task_0')).toBeChecked();
    await a.getByTestId('play-notes').fill('共同写下的第一行'); await a.getByTestId('play-save-notes').click();
    await expect(b.getByTestId('play-notes')).toHaveValue('共同写下的第一行');
    if (template === 'project') {
      let release;
      await a.route(`**/g-api/${room.id}/actions`, async route => {
        if (route.request().postDataJSON().type !== 'notes') return route.continue();
        const response = await route.fetch();
        await new Promise(resolve => { release = async () => { await route.fulfill({ response }); resolve(); }; });
      });
      await a.getByTestId('play-notes').fill('先保存的草稿'); await a.getByTestId('play-save-notes').click();
      await expect.poll(() => Boolean(release)).toBe(true);
      await a.getByTestId('play-notes').fill('保存期间继续写下的新句子'); await release();
      await expect(a.getByTestId('play-save-notes')).toBeEnabled();
      await expect(a.getByTestId('play-notes')).toHaveValue('保存期间继续写下的新句子');
      await a.unroute(`**/g-api/${room.id}/actions`);
    }
    assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile page overflows');
    await a.screenshot({ path: join(evidence, 'screenshots', `${template}-room-desktop.png`), fullPage: true });
    await b.screenshot({ path: join(evidence, 'screenshots', `${template}-room-mobile.png`), fullPage: true });
    if (template === 'travel') {
      await b.getByTestId('play-notes').fill('断线时还没保存的草稿');
      await b.route('**/g-api/**', route => route.abort());
      await expect(b.getByTestId('play-connection-state')).toContainText('连接中断', { timeout: 7000 });
      await expect(b.getByTestId('play-room')).not.toContainText('这次相聚已经结束');
      await b.unroute('**/g-api/**');
      await expect(b.getByTestId('play-connection-state')).toHaveCount(0, { timeout: 7000 });
      await expect(b.getByTestId('play-notes')).toHaveValue('断线时还没保存的草稿');
    }
    await b.reload(); await expect(b.getByTestId('play-room')).toBeVisible();
    await aContext.close(); await bContext.close(); await owner.getByTestId('play-back').click();
  }
  const oldest = host.playrooms.list().at(-1);
  for (let i = 0; i < 13; i++) host.playrooms.create({ template: 'twin', title: `后来的房间 ${i}`, brief: '合成背景', persona: '合成人格', clientId: crypto.randomUUID() }, host.store.get('contact', 'agent_codex'));
  host.store.put('play_job', { id: 'pj_review_unknown', roomId: oldest.id, backend: 'codex', actorId: 'self', status: 'unknown' });
  host.store.put('play_job', { id: 'pj_review_failed', roomId: oldest.id, backend: 'codex', actorId: 'self', status: 'failed' });
  await owner.reload(); await owner.getByTestId('im-playrooms-open').click(); await owner.getByTestId(`play-open-${oldest.id}`).click();
  await expect(owner.getByTestId('play-reconcile-pj_review_unknown')).toBeVisible();
  assert.deepEqual(errors, []); verdict = 'passed';
} finally {
  await writeFile(join(evidence, 'browser-verdict.json'), JSON.stringify({ verdict, errors, scope: 'synthetic browser transport, not real model or public tunnel', viewports: ['1280x900', '390x844'] }, null, 2));
  await browser.close(); await host.close();
}
console.log('Playrooms acceptance passed: three cases, two independent guests, shared state, reload, desktop/mobile.');
