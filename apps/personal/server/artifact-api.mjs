import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { APIError, digest } from './store.mjs';

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/plain', '.txt': 'text/plain' };
const fail = (status, code, message) => { throw new APIError(status, code, message); };
const fields = (body, allowed) => { if (Object.keys(body).some(key => !allowed.includes(key))) fail(400, 'bad_request', '包含不支持的选项'); };

/** Owner-facing fixed capabilities. Agent callers exclusively use CreationService. */
export class ArtifactAPI {
  constructor(service, kick) { this.service = service; this.store = service.store; this.kick = kick; this.previews = new Map(); }
  detail(artifactId) {
    const artifact = this.store.require('workspace_artifact', artifactId);
    return { artifact, revisions: this.store.list('artifact_revision').filter(item => item.artifactId === artifactId && item.state === 'committed').reverse(),
      contributions: this.store.list('artifact_contribution').filter(item => item.artifactId === artifactId),
      links: this.store.list('artifact_link').filter(item => item.artifactId === artifactId),
      collaborations: this.store.list('collaboration').filter(item => item.artifactId === artifactId) };
  }
  preview(artifactId, revisionId) {
    const checks = this.service.artifacts.check(revisionId, { owner: true }, { final: true });
    const revision = this.service.artifacts.revision(artifactId, revisionId);
    if (!checks.passed) fail(409, 'preview_not_checked', '这个版本尚未通过完整预览检查');
    for (const [key, value] of this.previews) if (value.expiresAt <= Date.now()) this.previews.delete(key);
    if (this.previews.size >= 64) this.previews.delete(this.previews.keys().next().value);
    const preview = { id: randomBytes(24).toString('hex'), artifactId, revisionId, expiresAt: Date.now() + 30 * 60000,
      files: Object.keys(revision.files).map(path => ({ id: digest(path), path, mime: types[extname(path)] || 'text/plain' })) };
    this.previews.set(preview.id, preview); return preview;
  }
  getPreview(previewId) {
    const preview = this.previews.get(previewId);
    if (!preview || preview.expiresAt <= Date.now()) fail(404, 'preview_expired', '预览已过期，请重新打开作品');
    return preview;
  }
  async route(method, path, readBody) {
    let match;
    if (method === 'GET' && path === '/api/library/artifacts') return { artifacts: this.store.list('workspace_artifact') };
    if (method === 'GET' && (match = path.match(/^\/api\/threads\/([A-Za-z0-9_-]+)\/creation$/))) { this.store.require('thread', match[1]); return this.service.forThread(match[1]); }
    if (method === 'POST' && (match = path.match(/^\/api\/creation-proposals\/([A-Za-z0-9_-]+)\/change$/))) {
      const body = await readBody(); fields(body, ['version', 'goal', 'tasks', 'paths', 'dependencies', 'clientId']); return this.service.ownerUpdate(match[1], body);
    }
    if (method === 'POST' && (match = path.match(/^\/api\/(creation-proposals|capability-requests)\/([A-Za-z0-9_-]+)\/decision$/))) {
      const body = await readBody(); fields(body, ['choice', 'version', 'clientId']);
      const result = match[1] === 'creation-proposals' ? this.service.decide(match[2], body) : this.service.decidePermission(match[2], body);
      this.kick(); return result;
    }
    if (method === 'POST' && (match = path.match(/^\/api\/collaborations\/([A-Za-z0-9_-]+)\/control$/))) {
      const body = await readBody(); fields(body, ['action', 'stepId', 'clientId']);
      const result = this.service.runtime.control(match[1], body); this.kick(); return result;
    }
    if ((match = path.match(/^\/api\/library\/artifacts\/([A-Za-z0-9_-]+)(?:\/(files|preview|share|resolve-local|change))?$/))) {
      const artifactId = match[1], action = match[2];
      if (method === 'GET' && !action) return this.detail(artifactId);
      if (method === 'POST' && action) {
        const body = await readBody();
        if (action === 'files') { fields(body, ['revisionId', 'path']); return this.service.artifacts.read(artifactId, body.revisionId, { owner: true }, body.path === undefined ? undefined : [body.path]); }
        if (action === 'preview') { fields(body, ['revisionId']); return this.preview(artifactId, body.revisionId); }
        if (action === 'change') {
          fields(body, ['action', 'expectedVersion', 'revisionId', 'path', 'text', 'expectedHash', 'clientId']);
          const result = this.store.idempotent(`artifact-change:${artifactId}`, body.clientId, body, () => this.service.artifacts.ownerChange(artifactId, body, { owner: true, contactId: 'self', runId: `human_${digest(body.clientId).slice(0, 32)}` }));
          this.service.notify(); return result;
        }
        if (action === 'share') { fields(body, ['threadId', 'revisionId', 'follow', 'paths', 'clientId']); return this.store.idempotent(`artifact-share:${artifactId}`, body.clientId, body, () => this.service.share(artifactId, body)); }
        if (action === 'resolve-local') { fields(body, ['action', 'clientId']); const result = this.store.idempotent(`artifact-local:${artifactId}`, body.clientId, body, () => this.service.artifacts.resolveLocal(artifactId, body.action, { owner: true })); this.service.notify(); return result; }
      }
    }
    if (method === 'GET' && (match = path.match(/^\/api\/library\/previews\/([a-f0-9]{48})(?:\/files\/([A-Za-z0-9_-]+))?$/))) {
      const preview = this.getPreview(match[1]);
      if (!match[2]) return preview;
      const file = preview.files.find(item => item.id === match[2]); if (!file) fail(404, 'file_not_found', '这个文件不属于预览版本');
      const read = this.service.artifacts.read(preview.artifactId, preview.revisionId, { owner: true }, [file.path]);
      return { ...read.files[0], mime: file.mime };
    }
    return undefined;
  }
  blockers() {
    return this.store.list('creation_proposal').filter(item => ['draft', 'ready', 'needs_input'].includes(item.state)).length
      + this.store.list('capability_request').filter(item => item.state === 'pending').length
      + this.store.list('collaboration').filter(item => !['completed', 'cancelled'].includes(item.status)).length;
  }
  close() { this.previews.clear(); }
}
