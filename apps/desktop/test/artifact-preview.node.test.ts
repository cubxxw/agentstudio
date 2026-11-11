import { describe, it, expect } from 'vitest';
import { artifactPreviewCsp, artifactPreviewResponse } from '../src/main/artifact-preview';
import { readPersonalRequest } from '../src/shared/personal-api';

describe('isolated artifact preview', () => {
  it('only serves a file in an explicit opaque immutable preview', async () => {
    const calls: string[] = [], id = 'a'.repeat(48);
    const response = await artifactPreviewResponse(`agentroom-artifact://${id}/assets/style.css`, async input => {
      calls.push(readPersonalRequest(input).path);
      return { status: 200, body: calls.length === 1 ? { files: [{ path: 'assets/style.css', id: 'file_hash', mime: 'text/css' }] } : { text: 'body{color:red}', mime: 'text/css' } };
    });
    expect(response.status).toBe(200); expect(await response.text()).toBe('body{color:red}');
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts');
    expect(artifactPreviewCsp).toContain("connect-src 'none'"); expect(artifactPreviewCsp).not.toContain('allow-same-origin');
  });
  it('rejects arbitrary destinations and nonmember files without filesystem access', async () => {
    for (const url of ['file:///etc/passwd', 'https://example.com/', `agentroom-artifact://${'a'.repeat(48)}/%2fetc/passwd`, `agentroom-artifact://${'a'.repeat(48)}/missing.html`]) {
      const response = await artifactPreviewResponse(url, async () => ({ status: 200, body: { files: [] } })); expect(response.status).toBe(404);
    }
  });
  it('allows only fixed library and decision IPC routes', () => {
    for (const path of ['/api/library/artifacts', '/api/library/artifacts/aw_own', '/api/threads/thr_own/creation']) expect(readPersonalRequest({ method: 'GET', path }).path).toBe(path);
    for (const path of ['/api/creation-proposals/creation_own/decision', '/api/capability-requests/permission_own/decision', '/api/library/artifacts/aw_own/share', '/api/collaborations/work_own/control']) expect(readPersonalRequest({ method: 'POST', path, body: {} }).path).toBe(path);
    for (const path of ['/api/library/artifacts/../../secrets', '/api/library/files/etc/passwd', '/api/library/artifacts/aw_own?path=etc']) expect(() => readPersonalRequest({ method: 'GET', path })).toThrow();
  });
});
