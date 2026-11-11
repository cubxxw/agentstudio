import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { artifactFileAction, readArtifactFileAction } from '../src/main/artifact-files';

it('exports only hash-checked revision files into a newly created directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'artifact-export-'));
  try {
    const result = await artifactFileAction({ kind: 'export', artifactId: 'aw_own', revisionId: 'rev_own' }, { dataDir: directory, chooseDirectory: async () => directory, reveal() {}, request: async input => ({ status: 200, body: input.method === 'GET' ? {} : { files: [{ path: 'assets/page.md', text: 'Checked bytes', sha256: createHash('sha256').update('Checked bytes').digest('hex') }] } }) });
    expect(readFileSync(join(result.path!, 'assets/page.md'), 'utf8')).toBe('Checked bytes');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it('rejects arbitrary paths and command fields in native file actions', () => {
  for (const item of [{ kind: 'export', artifactId: '../../secret', revisionId: 'rev_own' }, { kind: 'reveal', artifactId: 'aw_own', path: '/etc' }, { kind: 'shell', artifactId: 'aw_own' }]) expect(() => readArtifactFileAction(item)).toThrow();
});
