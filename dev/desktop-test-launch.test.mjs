import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { launchDesktopTest } from './desktop-test-env.mjs';

const revision = 'a'.repeat(40);
test('rejects old, unknown and mismatched builds before launching Electron', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agentroom-launch-'));
  let launches = 0;
  const electron = { launch: async () => { launches++; } };
  const env = { AGENTSTUDIO_USER_DATA_DIR: join(root, 'profile'), AGENTROOM_EXPECTED_BUILD_REF: revision };
  const options = { args: [root], env };
  const config = { runtimePath: join(root, 'Electron') };
  writeFileSync(config.runtimePath, 'synthetic runtime; never executed');
  try {
    await assert.rejects(launchDesktopTest(electron, options, config), /Rebuild/);
    const unknown = join(root, 'old-app');
    writeFileSync(unknown, 'not the pinned runtime');
    await assert.rejects(launchDesktopTest(electron, { ...options, executablePath: unknown }, config), /Unknown native test executable/);
    symlinkSync(unknown, join(root, 'old-app-link'));
    await assert.rejects(launchDesktopTest(electron, { ...options, executablePath: join(root, 'old-app-link') }, config), /Unknown native test executable/);
    mkdirSync(join(root, 'out/main'), { recursive: true });
    writeFileSync(join(root, 'out/main/build-info.json'), JSON.stringify({ revision: 'b'.repeat(40), automation: 1 }));
    await assert.rejects(launchDesktopTest(electron, options, config), /build mismatch/);
    writeFileSync(join(root, 'out/main/build-info.json'), JSON.stringify({ revision, automation: 0 }));
    await assert.rejects(launchDesktopTest(electron, options, config), /Rebuild/);
    writeFileSync(join(root, 'out/main/build-info.json'), JSON.stringify({ revision: `${revision}-dirty`, fingerprint: 'stale', automation: 1 }));
    await assert.rejects(launchDesktopTest(electron, { ...options, env: { ...env, AGENTROOM_EXPECTED_BUILD_REF: `${revision}-dirty` } }, config), /dirty builds require/);
    assert.equal(launches, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('serializes native sessions and releases the lock on close or failed launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agentroom-launch-'));
  mkdirSync(join(root, 'out/main'), { recursive: true });
  writeFileSync(join(root, 'out/main/build-info.json'), JSON.stringify({ revision, automation: 1 }));
  const env = { AGENTSTUDIO_USER_DATA_DIR: join(root, 'profile'), AGENTROOM_EXPECTED_BUILD_REF: revision };
  const options = { args: [root], env };
  const lock = join(root, 'desktop.lock');
  const config = { lockPath: lock, runtimePath: join(root, 'Electron') };
  writeFileSync(config.runtimePath, 'synthetic runtime; never executed');
  const electron = { launch: async () => new EventEmitter() };
  try {
    const app = await launchDesktopTest(electron, options, config);
    await assert.rejects(launchDesktopTest(electron, options, config), /Another native test/);
    app.emit('close');
    await assert.rejects(launchDesktopTest({ launch: async () => { throw new Error('launch failed'); } }, options, config), /launch failed/);
    const next = await launchDesktopTest(electron, options, config);
    next.emit('close');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
