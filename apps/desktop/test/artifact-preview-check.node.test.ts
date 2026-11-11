import { it, expect, vi, afterEach } from 'vitest';
const state = vi.hoisted(() => ({ windows: [] as any[], holdLoad: false }));
vi.mock('electron', () => ({ BrowserWindow: class {
  destroyed = false; width = 1280; release: () => void = () => {}; webContents: any;
  constructor() { state.windows.push(this); const result = () => Promise.resolve({ text: 100, width: this.width, horizontalOverflow: false, bridge: false }); this.webContents = { setWindowOpenHandler() {}, on() {}, executeJavaScript: vi.fn(result), executeJavaScriptInIsolatedWorld: vi.fn(result) }; }
  setContentSize(width: number) { this.width = width; }
  loadURL() { return state.holdLoad ? new Promise<void>(resolve => { this.release = resolve; }) : Promise.resolve(); }
  destroy() { this.destroyed = true; } isDestroyed() { return this.destroyed; }
} }));
import { ArtifactPreviewChecker } from '../src/main/artifact-preview-check';
afterEach(() => { state.windows.length = 0; state.holdLoad = false; vi.useRealTimers(); });
it('checks geometry in a world that generated scripts cannot overwrite', async () => {
  let reported: () => void = () => {}; const done = new Promise<void>(resolve => { reported = resolve; });
  const checker = new ArtifactPreviewChecker(async () => ({ status: 200, body: { id: 'a'.repeat(48) } }), () => reported());
  checker.enqueue({ workId: 'work', artifactId: 'aw_own', revisionId: 'rev_own' }); await done;
  expect(state.windows[0].webContents.executeJavaScript).not.toHaveBeenCalled(); expect(state.windows[0].webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalled(); checker.close();
});
it('a timed-out request cannot later create a window or take ownership of the next check', async () => {
  vi.useFakeTimers(); state.holdLoad = true; let releaseFirst: (value: any) => void = () => {};
  const first = new Promise<any>(resolve => { releaseFirst = resolve; });
  const checker = new ArtifactPreviewChecker(async request => (request.body as { revisionId: string }).revisionId === 'rev_first' ? first : { status: 200, body: { id: 'b'.repeat(48) } }, () => {});
  checker.enqueue({ workId: 'first', artifactId: 'aw_own', revisionId: 'rev_first' }); checker.enqueue({ workId: 'second', artifactId: 'aw_own', revisionId: 'rev_second' });
  await vi.advanceTimersByTimeAsync(12001); expect(state.windows).toHaveLength(1); const second = state.windows[0];
  releaseFirst({ status: 200, body: { id: 'a'.repeat(48) } }); await vi.advanceTimersByTimeAsync(0);
  expect(state.windows).toHaveLength(1); expect(second.destroyed).toBe(false); checker.close(); second.release(); await vi.advanceTimersByTimeAsync(0);
});
