import { mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { PersonalRequest, PersonalResponse } from '../shared/personal-api';

export type ArtifactFileAction = { kind: 'reveal' | 'export'; artifactId: string; revisionId?: string };
export function readArtifactFileAction(input: unknown): ArtifactFileAction {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请选择作品操作');
  const item = input as Record<string, unknown>;
  if (Object.keys(item).some(key => !['kind', 'artifactId', 'revisionId'].includes(key)) || !['reveal', 'export'].includes(String(item.kind)) || typeof item.artifactId !== 'string' || !/^aw_[A-Za-z0-9_-]{1,155}$/.test(item.artifactId) || (item.kind === 'export' && (typeof item.revisionId !== 'string' || !/^rev_[A-Za-z0-9_-]{1,155}$/.test(item.revisionId)))) throw new Error('无效的作品标识或版本');
  return item as ArtifactFileAction;
}
export async function artifactFileAction(action: ArtifactFileAction, options: {
  dataDir: string; request: (input: PersonalRequest) => Promise<PersonalResponse>;
  chooseDirectory: () => Promise<string | null>; reveal: (path: string) => void;
}): Promise<{ cancelled: boolean; path?: string }> {
  const metadata = await options.request({ method: 'GET', path: `/api/library/artifacts/${action.artifactId}` });
  if (metadata.status !== 200) throw new Error('找不到作品');
  if (action.kind === 'reveal') {
    const current = join(options.dataDir, 'artifacts', action.artifactId, 'current');
    if (realpathSync(current) !== current) throw new Error('作品目录发生改变，请先核对本地文件');
    options.reveal(current); return { cancelled: false };
  }
  const destination = await options.chooseDirectory(); if (!destination) return { cancelled: true };
  const result = await options.request({ method: 'POST', path: `/api/library/artifacts/${action.artifactId}/files`, body: { revisionId: action.revisionId } });
  if (result.status !== 200) throw new Error('所选版本无法读取');
  const files = (result.body as { files: { path: string; text: string; sha256: string }[] }).files;
  for (const file of files) if (!file.path || file.path.includes('\\') || file.path.includes(':') || file.path.includes('\0') || file.path.split('/').some(part => !part || ['.', '..', '.git', 'node_modules'].includes(part)) || createHash('sha256').update(file.text).digest('hex') !== file.sha256) throw new Error('导出文件校验失败');
  const root = join(destination, `AgentRoom-${action.artifactId}-${randomUUID().slice(0, 8)}`); mkdirSync(root, { mode: 0o700 });
  for (const file of files) {
    const filename = join(root, file.path); mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    const fd = openSync(filename, 'wx', 0o600); try { writeFileSync(fd, file.text); fsyncSync(fd); } finally { closeSync(fd); }
  }
  return { cancelled: false, path: root };
}
