import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { inspectMacSigning, loadMacSigning } from '../apps/desktop/macos-signing.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'agentroom-native-signing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = join(directory, 'AgentRoom.app');
  await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true });
  await mkdir(join(bundle, 'Contents/Resources'));
  await copyFile('/usr/bin/true', join(bundle, 'Contents/MacOS/AgentRoom'));
  await writeFile(join(bundle, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.cubxxw.agentstudio</string><key>CFBundleExecutable</key><string>AgentRoom</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleName</key><string>AgentRoom</string></dict></plist>');
  const entitlements = join(directory, 'entitlements.plist');
  await writeFile(entitlements, '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');
  return { bundle, entitlements };
}

function sign(bundle, entitlements, identity) {
  execFileSync('/usr/bin/codesign', ['--force', '--sign', identity, '--timestamp=none', '--options', '0', '--entitlements', entitlements, bundle], { stdio: 'pipe' });
}

test('native codesign output is read correctly for a local ad-hoc bundle', { skip: process.platform !== 'darwin' }, async t => {
  const { bundle, entitlements } = await fixture(t);
  sign(bundle, entitlements, '-');
  const receipt = await inspectMacSigning(bundle, { identity: '-', teamId: null });
  assert.equal(receipt.signed, 'ad-hoc');
  assert.match(receipt.designatedRequirement, /^cdhash /);
});

test('native certificate extraction verifies both different builds against one signer', { skip: process.platform !== 'darwin' || process.env.AGENTSTUDIO_MAC_SIGN_NATIVE !== '1' }, async t => {
  const signing = await loadMacSigning();
  assert.notEqual(signing.identity, '-', 'Opt-in native test requires a configured certificate');
  const { bundle, entitlements } = await fixture(t);
  const receipts = [], hashes = [];
  for (const version of ['a', 'b']) {
    await writeFile(join(bundle, 'Contents/Resources/version.txt'), version);
    sign(bundle, entitlements, signing.identity);
    receipts.push(await inspectMacSigning(bundle, signing));
    hashes.push(spawnSync('/usr/bin/codesign', ['-dvvv', bundle], { encoding: 'utf8' }).stderr.match(/^CDHash=(.+)$/m)?.[1]);
  }
  assert.ok(hashes[0] && hashes[1]);
  assert.notEqual(hashes[0], hashes[1]);
  assert.equal(receipts[0].signed, 'certificate');
  assert.equal(receipts[0].signingIdentitySha1, signing.identity);
  assert.equal(receipts[0].teamIdentifier, signing.teamId);
  assert.equal(receipts[0].designatedRequirement, receipts[1].designatedRequirement);
});
