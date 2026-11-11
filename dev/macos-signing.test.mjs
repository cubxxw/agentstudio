import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMacSigning, verifyMacSigning } from '../apps/desktop/macos-signing.mjs';

const identity = '1234567890ABCDEF1234567890ABCDEF12345678';
const teamId = 'ABCDE12345';
const config = { identity, teamId };
const entitlements = '<plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>';
const requirement = 'identifier "com.cubxxw.agentstudio" and anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345"';
const certificateSignature = `Identifier=com.cubxxw.agentstudio\nCodeDirectory flags=0x0(none)\nAuthority=Apple Development: Synthetic Test\nTeamIdentifier=${teamId}\ndesignated => ${requirement}\n`;

async function withConfig(contents, run) {
  const directory = await mkdtemp(join(tmpdir(), 'agentroom-signing-test-'));
  const path = join(directory, 'signing.json');
  try {
    if (contents !== null) await writeFile(path, contents);
    await run(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('a machine without signing configuration keeps the local ad-hoc build', async () => {
  await withConfig(null, async path => {
    assert.deepEqual(await loadMacSigning({}, path), { identity: '-', teamId: null });
  });
});

test('repeated builds use the same pinned local certificate and team', async () => {
  await withConfig(JSON.stringify({ identity: identity.toLowerCase(), teamId }), async path => {
    assert.deepEqual(await loadMacSigning({}, path), config);
  });
});

test('an explicit ad-hoc override skips even a broken machine configuration', async () => {
  await withConfig('{broken', async path => {
    assert.deepEqual(await loadMacSigning({ AGENTSTUDIO_MAC_SIGN_IDENTITY: '-' }, path), { identity: '-', teamId: null });
  });
});

test('an environment certificate override does not inherit another certificate team', async () => {
  await withConfig(JSON.stringify(config), async path => {
    await assert.rejects(loadMacSigning({ AGENTSTUDIO_MAC_SIGN_IDENTITY: identity }, path), /team/i);
    assert.deepEqual(await loadMacSigning({ AGENTSTUDIO_MAC_SIGN_IDENTITY: identity, AGENTSTUDIO_MAC_SIGN_TEAM: teamId }, path), config);
  });
});

test('broken or incomplete configuration fails instead of silently changing app identity', async () => {
  for (const contents of ['{broken', 'null', '[]', '{}', JSON.stringify({ identity }), JSON.stringify({ identity: 'Apple Development: first available', teamId })]) {
    await withConfig(contents, async path => { await assert.rejects(loadMacSigning({}, path)); });
  }
});

test('a requested configuration file must exist', async () => {
  await withConfig(null, async path => { await assert.rejects(loadMacSigning({ AGENTSTUDIO_MAC_SIGN_CONFIG: path }), /ENOENT/); });
});

test('a stray team override cannot silently fall back to ad-hoc', async () => {
  await withConfig(null, async path => { await assert.rejects(loadMacSigning({ AGENTSTUDIO_MAC_SIGN_TEAM: teamId }, path), /identity/i); });
});

test('a valid certificate signature reports its stable designated requirement', () => {
  assert.deepEqual(verifyMacSigning(config, certificateSignature, entitlements, identity), {
    signed: 'certificate', teamIdentifier: teamId, signingIdentitySha1: identity, designatedRequirement: requirement,
  });
});

test('certificate builds reject an unexpected signer or team', () => {
  assert.throws(() => verifyMacSigning(config, certificateSignature, entitlements, 'F'.repeat(40)), /certificate/i);
  assert.throws(() => verifyMacSigning(config, certificateSignature.replace(teamId, 'OTHER12345'), entitlements, identity), /team/i);
});

test('certificate builds reject ad-hoc or content-hash-only app identity', () => {
  assert.throws(() => verifyMacSigning(config, `${certificateSignature}\nSignature=adhoc`, entitlements, identity), /certificate/i);
  assert.throws(() => verifyMacSigning(config, certificateSignature.replace(requirement, 'cdhash H"0123456789"'), entitlements, identity), /requirement/i);
});

test('both signing modes retain the established local entitlement and runtime limits', () => {
  assert.throws(() => verifyMacSigning(config, certificateSignature.replace('0x0(none)', '0x10000(runtime)'), entitlements, identity), /runtime/i);
  assert.throws(() => verifyMacSigning(config, certificateSignature, entitlements.replace('</dict>', '<key>com.apple.security.get-task-allow</key><true/></dict>'), identity), /entitlement/i);
  assert.throws(() => verifyMacSigning(config, certificateSignature.replace('Identifier=com.cubxxw.agentstudio', 'Identifier=com.example.other'), entitlements, identity), /identifier/i);
});

test('explicit ad-hoc builds still verify as ad-hoc and disclose the changing identity', () => {
  const signature = 'Identifier=com.cubxxw.agentstudio\nCodeDirectory flags=0x2(adhoc)\nSignature=adhoc\nTeamIdentifier=not set\ndesignated => cdhash H"0123456789"\n';
  assert.deepEqual(verifyMacSigning({ identity: '-', teamId: null }, signature, entitlements), {
    signed: 'ad-hoc', teamIdentifier: null, signingIdentitySha1: null, designatedRequirement: 'cdhash H"0123456789"',
  });
});
