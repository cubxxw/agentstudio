import { constants, mkdirSync, realpathSync, lstatSync, existsSync, readdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, rmSync, readSync, readlinkSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { APIError, id, now, digest } from './store.mjs';

const fail = (status, code, message) => { throw new APIError(status, code, message); };
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const same = isDeepStrictEqual;
const mediaType = path => path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/plain';

function directory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path).normalize('NFC') !== path.normalize('NFC')) fail(400, 'invalid_path', '作品目录不能指向链接或普通文件');
}
export function validateArtifactPath(relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 240 || relative.includes('\\') || relative.includes('\0') || relative.startsWith('/') || relative.includes(':')) fail(400, 'invalid_path', '需要作品内的相对路径');
  const parts = relative.split('/');
  if (parts.some(part => !part || ['.', '..', '.git', 'node_modules', '__proto__', 'constructor', 'prototype'].includes(part))) fail(400, 'invalid_path', '路径包含不支持的目录或保留名称');
  return parts;
}
function safePath(root, relative, createParents = false) {
  const parts = validateArtifactPath(relative);
  directory(root);
  let path = root;
  for (const part of parts.slice(0, -1)) {
    path = join(path, part);
    if (createParents) directory(path);
    else if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) fail(400, 'invalid_path', '路径包含链接或无效目录');
  }
  path = join(path, parts.at(-1));
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) fail(400, 'invalid_path', '作品文件不能是链接或共享硬链接');
  }
  return path;
}
function atomic(path, bytes) {
  const temporary = `${path}.tmp_${randomUUID()}`;
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  const parent = openSync(dirname(path), constants.O_RDONLY);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
function scan(root, { strict = true } = {}) {
  directory(root);
  const files = {}; let total = 0;
  const visit = (path, prefix = '') => {
    for (const name of readdirSync(path).sort()) {
      const relative = (prefix ? `${prefix}/${name}` : name).normalize('NFC'), absolute = join(path, name), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) { if (strict) fail(400, 'invalid_path', '作品包含链接，未读取链接目标'); files[relative] = { type: 'link', sha256: digest(readlinkSync(absolute)) }; continue; }
      if (stat.isDirectory()) { if (strict) safePath(root, `${relative}/.path-check`); visit(absolute, relative); }
      else {
        if (!strict) {
          if (!stat.isFile()) { files[relative] = { type: 'special', size: stat.size }; continue; }
          const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536), fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
          try { let count; while ((count = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); } finally { closeSync(fd); }
          files[relative] = { sha256: hash.digest('hex'), size: stat.size, mediaType: mediaType(relative), ...(stat.nlink !== 1 ? { hardLinks: stat.nlink } : {}) }; continue;
        }
        safePath(root, relative);
        if (stat.size > 1_048_576) fail(413, 'file_limit', '单个文本文件不能超过 1 MiB');
        const bytes = readFileSync(absolute);
        total += bytes.length;
        if (Object.keys(files).length >= 256 || total > 33_554_432) fail(413, 'artifact_limit', '作品超过 256 个文件或 32 MiB');
        if (!Buffer.from(bytes.toString('utf8')).equals(bytes)) fail(400, 'invalid_content', '当前只支持 UTF-8 文本资源');
        files[relative] = { sha256: digest(bytes), size: bytes.length, mediaType: mediaType(relative) };
      }
    }
  };
  visit(root); return files;
}

/** Immutable content with checked CAS integration; current/ is a protected projection. */
export class ArtifactStore {
  constructor(store, { authorize = () => fail(403, 'permission_required', '请先批准作品权限') } = {}) {
    this.store = store; this.base = realpathSync(store.dataDir); this.authorize = authorize;
    this.recover();
  }
  root(artifactId) {
    if (!validId(artifactId) || !artifactId.startsWith('aw_')) fail(400, 'invalid_path', '无效作品标识');
    const parent = join(this.base, 'artifacts'); directory(parent);
    const root = join(parent, artifactId); directory(root); return root;
  }
  create({ title, kind }, context) {
    this.authorize(context, 'create');
    if (typeof title !== 'string' || !title.trim() || title.length > 120 || !['document', 'website'].includes(kind)) fail(400, 'invalid_artifact', '需要作品名称与支持的类型');
    const artifact = { id: id('aw'), title: title.trim(), kind, ownerId: 'self', headRevisionId: null, deliveredRevisionId: null, acceptedRevisionId: null, currentRevisionId: null,
      materializationState: 'clean', status: 'active', version: 1, createdAt: now(), updatedAt: now() };
    const root = this.root(artifact.id);
    for (const part of ['current', 'objects', 'revisions', 'local-backups']) directory(join(root, part));
    directory(join(root, 'objects', 'sha256'));
    this.store.put('workspace_artifact', artifact); this.project(artifact); return artifact;
  }
  project(artifact) { atomic(join(this.root(artifact.id), 'manifest.json'), JSON.stringify(artifact, null, 2)); }
  revision(artifactId, revisionId) {
    if (!revisionId) return { id: null, artifactId, files: {} };
    const revision = this.store.require('artifact_revision', revisionId);
    if (revision.artifactId !== artifactId) fail(404, 'not_found', '这个版本不属于所选作品');
    const manifest = JSON.parse(readFileSync(safePath(join(this.root(artifactId), 'revisions', revisionId), 'manifest.json'), 'utf8'));
    if (digest(JSON.stringify(manifest)) !== revision.manifestHash) fail(500, 'artifact_corrupted', '作品版本清单校验失败');
    return { ...revision, ...manifest };
  }
  object(artifactId, hash) {
    if (!/^[a-f0-9]{64}$/.test(hash || '')) fail(500, 'artifact_corrupted', '作品文件指纹无效');
    const objects = join(this.root(artifactId), 'objects'); directory(objects);
    const root = join(objects, 'sha256'); directory(root); return safePath(root, hash);
  }
  bytes(artifactId, file) {
    const bytes = readFileSync(this.object(artifactId, file.sha256));
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) fail(500, 'artifact_corrupted', '作品文件读回校验失败');
    return bytes;
  }
  captureRead(result) {
    return { ...result, files: result.files.map(({ text, ...file }) => {
      if (text !== undefined) {
        const bytes = Buffer.from(text); if (digest(bytes) !== file.sha256) fail(500, 'artifact_corrupted', '读取快照指纹不匹配');
        const target = this.object(result.artifactId, file.sha256); if (!existsSync(target)) atomic(target, bytes); this.bytes(result.artifactId, file);
      }
      return file;
    }) };
  }
  replayRead(result, context) {
    for (const file of result.files) this.authorize(context, 'read', result.artifactId, file.path, result.revisionId);
    return result.contentOmitted ? result : { ...result, files: result.files.map(file => ({ ...file, text: this.bytes(result.artifactId, file).toString('utf8') })) };
  }
  read(artifactId, revisionId, context, paths) {
    this.authorize(context, 'read', artifactId, undefined, revisionId);
    const revision = this.revision(artifactId, revisionId), names = paths || Object.keys(revision.files);
    if (!Array.isArray(names) || names.length > 256) fail(400, 'invalid_request', '读取文件范围无效');
    const files = names.map(path => {
      if (typeof path === 'string') path = path.normalize('NFC');
      validateArtifactPath(path);
      this.authorize(context, 'read', artifactId, path, revisionId);
      const file = Object.hasOwn(revision.files, path) && revision.files[path]; if (!file) fail(404, 'not_found', '这个版本没有所选文件');
      return { path, ...file, text: this.bytes(artifactId, file).toString('utf8') };
    });
    if (context.stageId) {
      const stage = this.ownStage(context.stageId, context);
      if (stage.artifactId !== artifactId || stage.baseRevisionId !== revisionId) fail(409, 'stale_revision', '读取版本不属于本次步骤输入');
      for (const file of files) stage.readSet[file.path] = file.sha256;
      this.store.put('artifact_stage', stage);
    }
    return { revision, files };
  }
  ownStage(stageId, context) {
    const stage = this.store.require('artifact_stage', stageId);
    if (stage.contactId !== context.contactId || stage.runId !== context.runId) fail(403, 'step_not_owned', '不能修改其他参与者的工作副本');
    this.authorize(context, 'write', stage.artifactId); return stage;
  }
  readStage(stageId, context, paths) {
    const stage = this.ownStage(stageId, context), current = scan(stage.directory), base = this.revision(stage.artifactId, stage.baseRevisionId), names = paths || Object.keys(current);
    if (!Array.isArray(names) || names.length > 256) fail(400, 'invalid_request', '读取文件范围无效');
    const files = names.map(path => {
      if (typeof path === 'string') path = path.normalize('NFC');
      this.authorize(context, 'read', stage.artifactId, path, stage.baseRevisionId);
      const file = current[path]; if (!file) fail(404, 'not_found', '工作副本没有所选文件');
      if (base.files[path]?.sha256 === file.sha256) stage.readSet[path] = file.sha256;
      return { path, ...file, text: readFileSync(safePath(stage.directory, path), 'utf8') };
    });
    this.store.put('artifact_stage', stage); return { baseRevisionId: stage.baseRevisionId, files };
  }
  stage(artifactId, stepId, baseRevisionId, context) {
    this.authorize(context, 'write', artifactId);
    if (!validId(stepId)) fail(400, 'invalid_path', '无效创作步骤');
    const stageId = `stage_${stepId}`, previous = this.store.get('artifact_stage', stageId);
    if (previous) {
      const existing = this.ownStage(stageId, context);
      if (existing.artifactId !== artifactId || existing.baseRevisionId !== baseRevisionId) fail(409, 'stale_revision', '步骤已经绑定其他输入版本');
      return existing;
    }
    const revision = this.revision(artifactId, baseRevisionId), parent = join(this.base, 'workspaces'); directory(parent);
    const stageRoot = join(parent, stageId); directory(stageRoot); const tree = join(stageRoot, 'tree'); directory(tree);
    for (const [path, file] of Object.entries(revision.files)) {
      this.authorize(context, 'read', artifactId, path, baseRevisionId);
      atomic(safePath(tree, path, true), this.bytes(artifactId, file));
    }
    const inputs = [...new Set(['brief.md', 'decisions.md', ...(context.mandatoryPaths || [])])];
    if (inputs.length > 256) fail(400, 'invalid_request', '步骤输入超过文件上限');
    const mandatoryInputs = Object.fromEntries(inputs.map(path => {
      safePath(tree, path); this.authorize(context, 'read', artifactId, path, baseRevisionId);
      return [path, revision.files[path]?.sha256 || null];
    }));
    return this.store.put('artifact_stage', { id: stageId, artifactId, stepId, baseRevisionId, contactId: context.contactId, runId: context.runId, directory: tree, readSet: {}, mandatoryInputs, createdAt: now() });
  }
  write(stageId, { path, text, expectedHash }, context) {
    if (typeof path === 'string') path = path.normalize('NFC');
    const stage = this.ownStage(stageId, context); this.authorize(context, 'write', stage.artifactId, path);
    const absolute = safePath(stage.directory, path, true), actual = existsSync(absolute) ? digest(readFileSync(absolute)) : null;
    if (expectedHash !== actual) fail(409, 'file_conflict', '文件已经变化，请读取当前指纹再修改');
    if (text === null) { if (existsSync(absolute)) unlinkSync(absolute); }
    else {
      if (typeof text !== 'string' || Buffer.byteLength(text) > 1_048_576) fail(413, 'file_limit', '需要不超过 1 MiB 的 UTF-8 文本');
      atomic(absolute, this.store.vault.redactString(text));
    }
    const files = scan(stage.directory);
    return { path, file: files[path] || null };
  }
  submit(stageId, context) {
    const stage = this.ownStage(stageId, context), files = scan(stage.directory), base = this.revision(stage.artifactId, stage.baseRevisionId), changes = {};
    for (const path of new Set([...Object.keys(base.files), ...Object.keys(files)])) if (!same(base.files[path], files[path])) {
      this.authorize(context, 'write', stage.artifactId, path);
      changes[path] = { before: base.files[path]?.sha256 || null, after: files[path] || null };
      if (files[path]) {
        const pathOnDisk = this.object(stage.artifactId, files[path].sha256), bytes = readFileSync(safePath(stage.directory, path));
        if (!existsSync(pathOnDisk)) atomic(pathOnDisk, bytes);
        this.bytes(stage.artifactId, files[path]);
      }
    }
    if (!Object.keys(changes).length) fail(409, 'empty_contribution', '没有可提交的文件修改');
    return this.store.put('artifact_contribution', { id: id('con'), artifactId: stage.artifactId, stageId, baseRevisionId: stage.baseRevisionId, changes,
      readSet: stage.readSet, mandatoryInputs: stage.mandatoryInputs, contactId: context.contactId, runId: context.runId, state: 'submitted', createdAt: now() });
  }
  candidate(contributionId, context) {
    const contribution = this.store.require('artifact_contribution', contributionId), artifact = this.store.require('workspace_artifact', contribution.artifactId);
    this.authorize(context, 'merge', artifact.id);
    if (contribution.state !== 'submitted') fail(409, 'contribution_quarantined', '这份贡献当前不能合成，请核对原授权与提交状态');
    const head = this.revision(artifact.id, artifact.headRevisionId);
    for (const [path, hash] of Object.entries({ ...contribution.mandatoryInputs, ...contribution.readSet })) if ((head.files[path]?.sha256 || null) !== hash) fail(409, 'stale_revision', '步骤依赖的需求或文件已经变化，请重新核对后提交');
    const files = { ...head.files };
    for (const [path, change] of Object.entries(contribution.changes)) {
      this.authorize(context, 'write', artifact.id, path);
      if ((head.files[path]?.sha256 || null) !== change.before && (head.files[path]?.sha256 || null) !== (change.after?.sha256 || null)) fail(409, 'file_conflict', '其他参与者已修改同一文件，已保留两份贡献');
      if (change.after) { this.bytes(artifact.id, change.after); files[path] = change.after; } else delete files[path];
    }
    const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    if (Object.keys(sorted).length > 256 || Object.values(sorted).reduce((sum, file) => sum + file.size, 0) > 33_554_432) fail(413, 'artifact_limit', '合成后作品超过大小上限');
    const revisionId = id('rev'), manifest = { id: revisionId, artifactId: artifact.id, parentRevisionId: artifact.headRevisionId, files: sorted, contributionIds: [contributionId] };
    const revision = { ...manifest, manifestHash: digest(JSON.stringify(manifest)), state: 'candidate', createdAt: now() };
    const root = join(this.root(artifact.id), 'revisions'); directory(root); const revisionRoot = join(root, revisionId); directory(revisionRoot);
    atomic(join(revisionRoot, 'manifest.json'), JSON.stringify(manifest)); this.store.put('artifact_revision', revision); return revision;
  }
  validateTree(revision) {
    const root = join(this.root(revision.artifactId), `.validate_${randomUUID()}`); directory(root);
    try {
      for (const [path, file] of Object.entries(revision.files).sort(([a], [b]) => a.localeCompare(b))) {
        const filename = safePath(root, path, true), fd = openSync(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { writeFileSync(fd, this.bytes(revision.artifactId, file)); } finally { closeSync(fd); }
      }
      if (!same(scan(root), revision.files)) fail(409, 'invalid_tree', '完整候选目录的文件指纹不匹配');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  check(revisionId, context, { final = false } = {}) {
    const initial = this.store.require('artifact_revision', revisionId); this.authorize(context, 'read', initial.artifactId, undefined, revisionId);
    const revision = this.revision(initial.artifactId, revisionId), artifact = this.store.require('workspace_artifact', initial.artifactId), errors = [];
    for (const [path, file] of Object.entries(revision.files)) {
      this.authorize(context, 'read', artifact.id, path, revisionId);
      const text = this.bytes(artifact.id, file).toString('utf8');
      if (!path.endsWith('.html')) continue;
      for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const target = match[1];
        if (target.startsWith('#') || target.startsWith('data:')) continue;
        if (/^(?:[a-z]+:|\/\/|\/)/i.test(target)) { errors.push(`${path}: 预览只支持作品内的相对资源`); continue; }
        const relative = posix.normalize(posix.join(posix.dirname(path), target.split(/[?#]/)[0]));
        if (!revision.files[relative]) errors.push(`${path}: 缺少资源 ${relative}`);
      }
    }
    try { this.validateTree(revision); } catch { errors.push('完整候选不能在本地卷形成无冲突的目录树'); }
    if (final && artifact.kind === 'website' && !revision.files['index.html']) errors.push('缺少网页入口 index.html');
    if (!Object.keys(revision.files).length) errors.push('作品没有内容');
    const result = { id: `check_${revisionId}`, revisionId, manifestHash: revision.manifestHash, parentRevisionId: revision.parentRevisionId, policyVersion: 2, final, passed: errors.length === 0, errors, checkedAt: now(), scope: 'integrity_and_static_resources' };
    this.store.put('artifact_check', result); return result;
  }
  commit(revisionId, expectedHead, context) {
    const revision = this.store.require('artifact_revision', revisionId); this.authorize(context, 'merge', revision.artifactId);
    const checks = this.store.require('artifact_check', `check_${revisionId}`);
    if (!checks.passed || checks.policyVersion !== 2 || checks.manifestHash !== revision.manifestHash || checks.parentRevisionId !== expectedHead) fail(409, 'checks_failed', '完整候选版本尚未通过对应检查');
    this.revision(revision.artifactId, revisionId);
    this.store.transaction(() => {
      const artifact = this.store.require('workspace_artifact', revision.artifactId);
      if (artifact.headRevisionId !== expectedHead || revision.parentRevisionId !== expectedHead) fail(409, 'stale_revision', '作品已产生更新，请重新合成并检查');
      artifact.headRevisionId = revisionId; artifact.version++; artifact.updatedAt = now(); artifact.materializationState = 'pending';
      this.store.put('workspace_artifact', artifact); revision.state = 'committed'; this.store.put('artifact_revision', revision);
      for (const contributionId of revision.contributionIds) {
        const contribution = this.store.require('artifact_contribution', contributionId); contribution.state = 'integrated'; contribution.revisionId = revisionId; this.store.put('artifact_contribution', contribution);
      }
    });
    if (context.deferMaterialization) { const artifact = this.store.require('workspace_artifact', revision.artifactId); artifact.materializationState = 'pending_delivery'; this.store.put('workspace_artifact', artifact); this.project(artifact); return artifact; }
    const artifact = this.materialize(revision.artifactId);
    if (context.owner && !context.internalWorkBootstrap && artifact.kind === 'document' && artifact.materializationState === 'clean') return this.markDelivered(artifact.id, revisionId);
    return artifact;
  }
  integrate(contributionId, context) {
    const previous = this.store.require('artifact_contribution', contributionId);
    this.authorize(context, 'merge', previous.artifactId);
    if (previous.state === 'integrated') return { artifact: this.store.require('workspace_artifact', previous.artifactId), revision: this.revision(previous.artifactId, previous.revisionId), checks: this.store.require('artifact_check', `check_${previous.revisionId}`) };
    const revision = this.candidate(contributionId, context), checks = this.check(revision.id, context);
    const artifact = this.commit(revision.id, revision.parentRevisionId, context);
    return { artifact, revision: this.store.require('artifact_revision', revision.id), checks };
  }
  markDelivered(artifactId, revisionId) {
    const artifact = this.store.require('workspace_artifact', artifactId), revision = this.revision(artifactId, revisionId);
    if (artifact.headRevisionId !== revisionId || artifact.currentRevisionId !== revisionId || artifact.materializationState !== 'clean' || revision.state !== 'committed') fail(409, 'version_conflict', '只能交付已核验并物化的当前版本');
    artifact.deliveredRevisionId = revisionId; artifact.version++; revision.deliveredAt ||= now();
    this.store.put('artifact_revision', revision); this.store.put('workspace_artifact', artifact); this.project(artifact); return artifact;
  }
  materialize(artifactId, options = {}) {
    try { return this.materializeTree(artifactId, options); }
    catch (error) { const artifact = this.store.require('workspace_artifact', artifactId); artifact.materializationState = 'unknown'; artifact.materializationError = error.code || 'materialization_failed'; this.store.put('workspace_artifact', artifact); try { this.project(artifact); } catch {} return artifact; }
  }
  materializeTree(artifactId, { preserve = false } = {}) {
    const artifact = this.store.require('workspace_artifact', artifactId), root = this.root(artifactId), current = join(root, 'current'); directory(current);
    const actual = scan(current, { strict: false }), old = this.revision(artifactId, artifact.currentRevisionId);
    if (!same(actual, old.files) && !preserve) {
      artifact.materializationState = 'blocked_by_local_changes'; this.store.put('workspace_artifact', artifact); this.project(artifact); return artifact;
    }
    const revision = this.revision(artifactId, artifact.headRevisionId), operationId = id('materialize'), next = join(root, `${operationId}_next`); directory(next);
    for (const [path, file] of Object.entries(revision.files)) atomic(safePath(next, path, true), this.bytes(artifactId, file));
    const backupRoot = join(root, 'local-backups'); directory(backupRoot); const backupPath = join(backupRoot, operationId);
    this.store.put('artifact_materialization', { id: operationId, artifactId, revisionId: revision.id, previousRevisionId: artifact.currentRevisionId, backupPath, next, state: 'prepared' });
    const blocked = () => { artifact.materializationState = 'blocked_by_local_changes'; this.store.put('workspace_artifact', artifact); this.store.put('artifact_materialization', { id: operationId, artifactId, revisionId: revision.id, backupPath, next, state: 'blocked' }); this.project(artifact); return artifact; };
    if (!same(scan(current, { strict: false }), actual)) return blocked();
    renameSync(current, backupPath);
    if (!same(scan(backupPath, { strict: false }), actual)) { renameSync(backupPath, current); return blocked(); }
    renameSync(next, current);
    // Keep the old tree even when initially clean: open file handles may modify it.
    artifact.currentRevisionId = revision.id; artifact.materializationState = 'clean';
    this.store.put('workspace_artifact', artifact); this.store.put('artifact_materialization', { id: operationId, artifactId, revisionId: revision.id, backupPath, state: 'completed' });
    this.project(artifact); return { ...artifact, ...(preserve ? { backupPath } : {}) };
  }
  inspectLocal(artifactId) {
    const artifact = this.store.require('workspace_artifact', artifactId);
    try {
      if (!same(scan(join(this.root(artifactId), 'current'), { strict: false }), this.revision(artifactId, artifact.currentRevisionId).files)) {
        artifact.materializationState = 'blocked_by_local_changes'; this.store.put('workspace_artifact', artifact);
      } else if (artifact.headRevisionId === artifact.currentRevisionId && artifact.materializationState === 'blocked_by_local_changes') {
        artifact.materializationState = 'clean'; this.store.put('workspace_artifact', artifact);
      }
    } catch { artifact.materializationState = 'blocked_by_local_changes'; this.store.put('workspace_artifact', artifact); }
    return artifact;
  }
  resolveLocal(artifactId, action, context) {
    this.authorize(context, 'merge', artifactId);
    if (action !== 'preserve-and-update') fail(400, 'invalid_action', '请选择保留本地副本后采用新版本');
    return this.materialize(artifactId, { preserve: true });
  }
  ownerChange(artifactId, input, context) {
    if (!context.owner) fail(403, 'permission_required', '这项动作需要作品所有者');
    const artifact = this.store.require('workspace_artifact', artifactId);
    if (artifact.version !== input.expectedVersion) fail(409, 'version_conflict', '作品已经更新，请重新查看后操作');
    if (['accept', 'archive', 'unarchive'].includes(input.action)) {
      if (input.action === 'accept') { const revision = this.revision(artifactId, input.revisionId); if (revision.state !== 'committed') fail(409, 'invalid_revision', '只能接受已整合版本'); artifact.acceptedRevisionId = revision.id; }
      else artifact.status = input.action === 'archive' ? 'archived' : 'active';
      artifact.version++; artifact.updatedAt = now(); artifact.lastOwnerOperation = { id: context.runId, action: input.action, revisionId: input.revisionId, expectedVersion: input.expectedVersion }; this.store.put('workspace_artifact', artifact); this.project(artifact); return artifact;
    }
    if (!['edit', 'restore', 'import-local'].includes(input.action)) fail(400, 'invalid_action', '请选择编辑、接受、恢复或归档');
    const baseId = input.action === 'import-local' ? artifact.currentRevisionId : artifact.headRevisionId;
    const stage = this.stage(artifactId, context.runId, baseId, context), base = this.revision(artifactId, baseId);
    if (input.action === 'edit') this.write(stage.id, { path: input.path, text: input.text, expectedHash: input.expectedHash }, context);
    else {
      const local = input.action === 'import-local', target = local ? scan(join(this.root(artifactId), 'current')) : this.revision(artifactId, input.revisionId).files;
      for (const path of new Set([...Object.keys(base.files), ...Object.keys(target)])) {
        if (base.files[path]?.sha256 === target[path]?.sha256) continue;
        const text = target[path] ? local ? readFileSync(safePath(join(this.root(artifactId), 'current'), path), 'utf8') : this.bytes(artifactId, target[path]).toString('utf8') : null;
        if (text !== null && digest(text) !== target[path].sha256) fail(409, 'local_changes', '读取期间本地文件又改变了，请保留后重试');
        this.write(stage.id, { path, text, expectedHash: base.files[path]?.sha256 || null }, context);
      }
    }
    const contribution = this.submit(stage.id, context); contribution.summary = input.action === 'import-local' ? '导入人的本地修改' : input.action === 'restore' ? `恢复版本 ${input.revisionId}` : '人编辑文件'; this.store.put('artifact_contribution', contribution);
    const result = this.integrate(contribution.id, context);
    return input.action === 'import-local' ? this.materialize(artifactId, { preserve: true }) : result.artifact;
  }
  recover() {
    for (const operation of this.store.list('artifact_materialization').filter(item => item.state === 'prepared')) {
      try {
        if (!validId(operation.id)) fail(500, 'artifact_corrupted', '物化记录无效');
        const root = this.root(operation.artifactId), current = join(root, 'current'), next = join(root, `${operation.id}_next`), backupRoot = join(root, 'local-backups'); directory(backupRoot);
        const backup = join(backupRoot, operation.id), artifact = this.store.require('workspace_artifact', operation.artifactId);
        if (artifact.headRevisionId !== operation.revisionId) { this.store.put('artifact_materialization', { ...operation, state: 'superseded' }); continue; }
        const revision = this.revision(artifact.id, operation.revisionId);
        if (!existsSync(current) && existsSync(next)) renameSync(next, current);
        else if (!existsSync(current) && existsSync(backup)) renameSync(backup, current);
        if (existsSync(current) && same(scan(current), revision.files)) {
          artifact.currentRevisionId = revision.id; artifact.materializationState = 'clean';
          this.store.put('workspace_artifact', artifact); this.store.put('artifact_materialization', { ...operation, state: 'completed' }); this.project(artifact);
        }
      } catch {
        const artifact = this.store.get('workspace_artifact', operation.artifactId);
        if (artifact) this.store.put('workspace_artifact', { ...artifact, materializationState: 'unknown' });
      }
    }
    for (const artifact of this.store.list('workspace_artifact').filter(item => item.materializationState === 'pending')) {
      try { this.materialize(artifact.id); }
      catch { this.store.put('workspace_artifact', { ...artifact, materializationState: 'unknown' }); }
    }
  }
}
