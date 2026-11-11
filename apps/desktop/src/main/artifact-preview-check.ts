import { BrowserWindow } from 'electron';
import type { PersonalRequest, PersonalResponse } from '../shared/personal-api';
export type PreviewTarget = { workId: string; artifactId: string; revisionId: string };
export type PreviewChecks = { passed: boolean; errors: string[]; viewports: { width: number; horizontalOverflow: boolean }[] };

/** One owned, hidden, sandboxed window at a time. Model output cannot report its own pass. */
export class ArtifactPreviewChecker {
  private queue = Promise.resolve();
  private pending = new Set<string>();
  private window: BrowserWindow | null = null;
  private closed = false;
  constructor(private request: (input: PersonalRequest) => Promise<PersonalResponse>, private report: (target: PreviewTarget, checks: PreviewChecks) => void) {}
  enqueue(target: PreviewTarget) {
    const key = `${target.workId}:${target.revisionId}`;
    if (this.closed || this.pending.has(key)) return;
    this.pending.add(key);
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      const checks: PreviewChecks = { passed: false, errors: [], viewports: [] };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.check(target, checks), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('预览检查超时')), 12000); })]);
        checks.passed = checks.errors.length === 0;
      } catch (error) { checks.errors.push((error as Error).message.slice(0, 500)); }
      finally { clearTimeout(timeout); this.window?.destroy(); this.window = null; this.pending.delete(key); }
      if (!this.closed) this.report(target, checks);
    });
  }
  private async check(target: PreviewTarget, checks: PreviewChecks) {
    const result = await this.request({ method: 'POST', path: `/api/library/artifacts/${target.artifactId}/preview`, body: { revisionId: target.revisionId } });
    if (result.status !== 200) throw new Error('预览版本未通过静态检查');
    const preview = result.body as { id: string };
    if (!/^[a-f0-9]{48}$/.test(preview.id)) throw new Error('无效预览能力');
    const prefix = `agentroom-artifact://${preview.id}/`;
    const win = new BrowserWindow({ show: false, width: 1280, height: 850, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
    this.window = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(prefix)) event.preventDefault(); });
    win.webContents.on('console-message', event => { if (event.level === 'error' && checks.errors.length < 30) checks.errors.push(event.message.slice(0, 500)); });
    win.webContents.on('render-process-gone', () => checks.errors.push('预览进程中断'));
    await win.loadURL(`${prefix}index.html`);
    for (const width of [1280, 390]) {
      win.setContentSize(width, 850);
      const page = await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ text: document.body?.innerText?.length || 0, width: innerWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2, bridge: typeof window.agentStudioPersonal !== 'undefined' }))))`);
      if (!page.text) checks.errors.push(`预览在 ${width}px 没有可见内容`);
      if (page.bridge) checks.errors.push('预览错误地获得原生 bridge');
      checks.viewports.push({ width: page.width, horizontalOverflow: page.horizontalOverflow });
      if (page.horizontalOverflow) checks.errors.push(`预览在 ${width}px 出现横向溢出`);
    }
  }
  close() { this.closed = true; this.window?.destroy(); this.window = null; }
}
