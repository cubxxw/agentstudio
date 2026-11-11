import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { APIError, digest } from './store.mjs';

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/plain', '.txt': 'text/plain' };
const fail = (status, code, message) => { throw new APIError(status, code, message); };
const fields = (body, allowed) => { if (Object.keys(body).some(key => !allowed.includes(key))) fail(400, 'bad_request', '包含不支持的选项'); };

/** Owner-facing fixed capabilities. Agent callers exclusively use CreationService. */
export class ArtifactAPI {
  constructor(service, kick) { this.service = service; this.store = service.store; this.kick = kick; this.previews = new Map(); this.recoverOwnerOperations(); }
  detail(artifactId) {
    const artifact = this.service.artifacts.inspectLocal(artifactId);
    return { artifact, revisions: this.store.list('artifact_revision').filter(item => item.artifactId === artifactId && item.state === 'committed').reverse(),
      contributions: this.store.list('artifact_contribution').filter(item => item.artifactId === artifactId),
      links: this.store.list('artifact_link').filter(item => item.artifactId === artifactId),
      permissions: this.store.list('capability_request').filter(item => item.artifactId === artifactId), ownerOperations: this.store.list('artifact_owner_operation').filter(item => item.artifactId === artifactId),
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
  recoverOwnerOperations() {
    for (const operation of this.store.list('artifact_owner_operation').filter(item => ['pending', 'unknown'].includes(item.state))) {
      try {
        const artifact = this.store.require('workspace_artifact', operation.artifactId), contribution = this.store.list('artifact_contribution').find(item => item.runId === operation.id && item.state === 'integrated');
        const metadataApplied = artifact.lastOwnerOperation?.id === operation.id && artifact.lastOwnerOperation?.action === operation.action && artifact.lastOwnerOperation?.expectedVersion === operation.expectedVersion;
        if (contribution) this.service.artifacts.revision(artifact.id, contribution.revisionId);
        if (contribution || metadataApplied) this.store.put('artifact_owner_operation', { ...operation, state: 'completed', result: artifact, recoveredAt: new Date().toISOString() });
        else if (artifact.version === operation.expectedVersion) this.store.put('artifact_owner_operation', { ...operation, state: 'failed', error: { status: 409, code: 'interrupted_before_commit', message: '原操作在整合前中断；工作副本已保留，请查看后重新保存' } });
      } catch { /* Preserve an unprovable effect for explicit owner reconciliation. */ }
    }
  }
  ownerChange(artifactId, body) {
    if (body.action === 'reconcile-owner') return this.store.idempotent(`owner-resolution:${artifactId}`, body.clientId, body, () => {
      const artifact = this.store.require('workspace_artifact', artifactId), operation = this.store.require('artifact_owner_operation', body.operationId);
      if (body.confirmedReviewed !== true || operation.artifactId !== artifactId || !['pending', 'unknown'].includes(operation.state) || artifact.version !== body.expectedVersion) fail(409, 'review_required', '请先核查当前版本、工作副本和原操作，再确认放弃未确认回执');
      this.store.put('artifact_owner_operation', { ...operation, state: 'abandoned', reconciliation: { source: 'owner_reviewed_current_state', checkedAt: new Date().toISOString() } }); return artifact;
    });
    const route = `artifact-change:${artifactId}`, replay = this.store.replay(route, body.clientId, body);
    if (replay.found) {
      const operation = this.store.require('artifact_owner_operation', replay.value.id);
      if (operation.state === 'completed') return operation.result;
      if (operation.state === 'failed') fail(operation.error.status, operation.error.code, operation.error.message);
      fail(409, 'operation_unknown', '原文件操作尚未核查，请查看已保存版本；没有重复执行');
    }
    const operation = { id: `owner_${digest(`${artifactId}:${body.clientId}`).slice(0, 32)}`, artifactId, action: body.action, expectedVersion: body.expectedVersion, revisionId: body.revisionId, state: 'pending' };
    this.store.idempotent(route, body.clientId, body, () => this.store.put('artifact_owner_operation', operation));
    try {
      // Effects run outside the reservation transaction: ArtifactStore owns the
      // head transaction and only materializes after that commit succeeds.
      const result = this.service.artifacts.ownerChange(artifactId, body, { owner: true, contactId: 'self', runId: operation.id });
      this.store.put('artifact_owner_operation', { ...operation, state: 'completed', result }); return result;
    } catch (error) {
      const safe = { status: error.status || 500, code: error.code || 'operation_unknown', message: error.status ? error.message : '文件操作未确认，请核查已保存版本和工作副本' };
      this.store.put('artifact_owner_operation', { ...operation, state: error.status ? 'failed' : 'unknown', error: safe }); fail(safe.status, safe.code, safe.message);
    }
  }
  async route(method, path, readBody) {
    let match;
    if (method === 'GET' && (match = path.match(/^\/api\/collaborations\/([A-Za-z0-9_-]+)$/))) { const work = this.store.require('collaboration', match[1]); const thread = this.store.require('thread', work.threadId); return { ...work, runs: thread.runs.filter(run => run.collaboration?.workId === work.id) }; }
    if (method === 'GET' && (match = path.match(/^\/api\/capability-requests\/([A-Za-z0-9_-]+)$/))) return this.store.require('capability_request', match[1]);
    if (method === 'POST' && (match = path.match(/^\/api\/capability-requests\/([A-Za-z0-9_-]+)\/revoke$/))) { const body = await readBody(); fields(body, ['version', 'clientId']); return this.service.revokePermission(match[1], body); }
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
      const body = await readBody(); fields(body, ['action', 'stepId', 'runId', 'choice', 'confirmedStopped', 'clientId']);
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
          fields(body, ['action', 'expectedVersion', 'revisionId', 'path', 'text', 'expectedHash', 'operationId', 'confirmedReviewed', 'clientId']);
          const result = this.ownerChange(artifactId, body);
          this.service.notify(); return result;
        }
        if (action === 'share') { fields(body, ['threadId', 'revisionId', 'follow', 'paths', 'revoke', 'expectedVersion', 'clientId']); return this.store.idempotent(`artifact-share:${artifactId}`, body.clientId, body, () => this.service.share(artifactId, body)); }
        if (action === 'resolve-local') { fields(body, ['action', 'clientId']); const result = this.store.idempotent(`artifact-local:${artifactId}`, body.clientId, body, () => this.service.artifacts.resolveLocal(artifactId, body.action, { owner: true })); this.service.runtime.resumeAfterLocal(artifactId); this.service.notify(); return result; }
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
      + this.store.list('collaboration').filter(item => !['completed', 'cancelled'].includes(item.status)).length
      + this.store.list('artifact_owner_operation').filter(item => ['pending', 'unknown'].includes(item.state)).length;
  }
  close() { this.previews.clear(); }
}
