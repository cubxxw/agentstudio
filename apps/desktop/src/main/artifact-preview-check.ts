import { BrowserWindow } from 'electron';
import type { PersonalRequest, PersonalResponse } from '../shared/personal-api';
export type PreviewTarget = { workId: string; artifactId: string; revisionId: string };
export type PreviewChecks = { passed: boolean; errors: string[]; viewports: { width: number; horizontalOverflow: boolean }[] };
type CheckScope = { cancelled: boolean; window: BrowserWindow | null };

/** A private window and cancellation scope per check; late results never own another check. */
export class ArtifactPreviewChecker {
  private queue = Promise.resolve(); private pending = new Set<string>(); private active: CheckScope | null = null; private closed = false;
  constructor(private request: (input: PersonalRequest) => Promise<PersonalResponse>, private report: (target: PreviewTarget, checks: PreviewChecks) => void) {}
  enqueue(target: PreviewTarget) {
    const key = `${target.workId}:${target.revisionId}`; if (this.closed || this.pending.has(key)) return; this.pending.add(key);
    this.queue = this.queue.then(async () => {
      if (this.closed) { this.pending.delete(key); return; }
      const scope: CheckScope = { cancelled: false, window: null }; this.active = scope;
      const checks: PreviewChecks = { passed: false, errors: [], viewports: [] }; let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.check(target, checks, scope), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { scope.cancelled = true; this.destroy(scope); reject(new Error('预览检查超时')); }, 12000); })]);
        checks.passed = checks.errors.length === 0;
      } catch (error) { checks.errors.push((error as Error).message.slice(0, 500)); }
      finally { clearTimeout(timeout); scope.cancelled = true; this.destroy(scope); if (this.active === scope) this.active = null; this.pending.delete(key); }
      if (!this.closed) this.report(target, checks);
    });
  }
  private destroy(scope: CheckScope) { if (scope.window && !scope.window.isDestroyed()) scope.window.destroy(); scope.window = null; }
  private live(scope: CheckScope) { if (this.closed || scope.cancelled) throw new Error('预览检查已取消'); }
  private async check(target: PreviewTarget, checks: PreviewChecks, scope: CheckScope) {
    const result = await this.request({ method: 'POST', path: `/api/library/artifacts/${target.artifactId}/preview`, body: { revisionId: target.revisionId } }); this.live(scope);
    if (result.status !== 200) throw new Error('预览版本未通过静态检查');
    const preview = result.body as { id: string }; if (!/^[a-f0-9]{48}$/.test(preview.id)) throw new Error('无效预览能力');
    const prefix = `agentroom-artifact://${preview.id}/`;
    const win = new BrowserWindow({ show: false, width: 1280, height: 850, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } }); scope.window = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(prefix)) event.preventDefault(); });
    win.webContents.on('console-message', event => { if (!scope.cancelled && event.level === 'error' && checks.errors.length < 30) checks.errors.push(event.message.slice(0, 500)); });
    win.webContents.on('render-process-gone', () => { if (!scope.cancelled) checks.errors.push('预览进程中断'); });
    await win.loadURL(`${prefix}index.html`); this.live(scope);
    for (const width of [1280, 390]) {
      win.setContentSize(width, 850);
      const page = await win.webContents.executeJavaScriptInIsolatedWorld(1108, [{ code: `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ text: document.body?.innerText?.length || 0, width: innerWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2, bridge: typeof window.agentStudioPersonal !== 'undefined' }))))` }]); this.live(scope);
      if (!page || typeof page.text !== 'number' || typeof page.horizontalOverflow !== 'boolean' || typeof page.bridge !== 'boolean') throw new Error('预览几何回执无效');
      if (!page.text) checks.errors.push(`预览在 ${width}px 没有可见内容`); if (page.bridge) checks.errors.push('预览错误地获得原生 bridge');
      checks.viewports.push({ width: page.width, horizontalOverflow: page.horizontalOverflow }); if (page.horizontalOverflow) checks.errors.push(`预览在 ${width}px 出现横向溢出`);
    }
  }
  close() { this.closed = true; if (this.active) { this.active.cancelled = true; this.destroy(this.active); } this.pending.clear(); }
}
