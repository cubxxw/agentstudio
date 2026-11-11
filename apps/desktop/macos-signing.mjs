import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

// Machine-local pins keep every checkout on the same identity without putting
// a developer's account, private key or Keychain password in the repository.
export async function loadMacSigning(env = process.env, defaultPath = join(homedir(), '.config', 'agentstudio', 'macos-signing.json')) {
  let config;
  if (env.AGENTSTUDIO_MAC_SIGN_IDENTITY !== undefined) {
    config = { identity: env.AGENTSTUDIO_MAC_SIGN_IDENTITY, teamId: env.AGENTSTUDIO_MAC_SIGN_TEAM };
  } else {
    if (env.AGENTSTUDIO_MAC_SIGN_TEAM !== undefined) throw new Error('Set AGENTSTUDIO_MAC_SIGN_IDENTITY together with the team override.');
    const path = env.AGENTSTUDIO_MAC_SIGN_CONFIG ?? defaultPath;
    try { config = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT' && env.AGENTSTUDIO_MAC_SIGN_CONFIG === undefined) return { identity: '-', teamId: null };
      throw error;
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('macOS signing configuration must be an object.');
  if (config.identity === '-') return { identity: '-', teamId: null };
  if (typeof config.identity !== 'string' || !/^[a-f0-9]{40}$/i.test(config.identity)) throw new Error('Pin the macOS signing identity by its 40-character certificate SHA-1, or explicitly use "-" for ad-hoc.');
  if (typeof config.teamId !== 'string' || !/^[A-Z0-9]{10}$/.test(config.teamId)) throw new Error('Certificate signing requires the expected 10-character team ID.');
  return { identity: config.identity.toUpperCase(), teamId: config.teamId };
}

export function macSigningOptions(signing) {
  return {
    identity: signing.identity, identityValidation: signing.identity !== '-', continueOnError: false,
    // Preserve the existing local runtime profile. This is not a notarized
    // distribution profile, even when an Apple Development certificate is used.
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none', entitlements: ['com.apple.security.cs.allow-jit'],
      additionalArguments: ['--options', '0'] }),
    preAutoEntitlements: false, preEmbedProvisioningProfile: false, gatekeeperAssess: false,
  };
}

export function verifyMacSigning(signing, signature, entitlements, leafSha1 = null) {
  if (!/^Identifier=com\.cubxxw\.agentstudio$/m.test(signature)) throw new Error('Unexpected macOS bundle signing identifier.');
  if (/flags=[^\n]*runtime/.test(signature)) throw new Error('Unexpected Hardened Runtime in the local signing profile.');
  if (!entitlements.includes('<key>com.apple.security.cs.allow-jit</key>') || (entitlements.match(/<key>/g) || []).length !== 1) throw new Error('Unexpected entitlements in the local signing profile.');
  const requirement = signature.match(/^\s*(?:#\s*)?designated => (.+)$/m)?.[1];
  if (!requirement) throw new Error('The app has no readable designated requirement.');
  const adHoc = /^Signature=adhoc$/m.test(signature);
  const actualTeam = signature.match(/^TeamIdentifier=(.+)$/m)?.[1];
  if (signing.identity === '-') {
    if (!adHoc || actualTeam !== 'not set') throw new Error('The resulting app does not match the local ad-hoc signing profile.');
  } else {
    if (adHoc || leafSha1 !== signing.identity) throw new Error('The resulting app does not use the pinned signing certificate.');
    if (actualTeam !== signing.teamId) throw new Error('The resulting app does not use the expected signing team.');
    if (/\bcdhash\b/.test(requirement) || !/\banchor\b/.test(requirement) || !/\bcertificate\b/.test(requirement)) throw new Error('Certificate signing did not produce a stable designated requirement.');
  }
  return {
    signed: adHoc ? 'ad-hoc' : 'certificate', teamIdentifier: adHoc ? null : actualTeam,
    signingIdentitySha1: adHoc ? null : leafSha1, designatedRequirement: requirement,
  };
}

export async function inspectMacSigning(bundle, signing) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  const signature = spawnSync('/usr/bin/codesign', ['-dvv', '-r-', bundle], { encoding: 'utf8' });
  const entitlements = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', bundle], { encoding: 'utf8' });
  if (signature.status !== 0 || entitlements.status !== 0) throw new Error('Could not inspect the local macOS signature.');
  let leafSha1 = null;
  if (signing.identity !== '-') {
    const directory = await mkdtemp(join(tmpdir(), 'agentroom-signature-'));
    try {
      const prefix = join(directory, 'cert');
      execFileSync('/usr/bin/codesign', ['-d', `--extract-certificates=${prefix}`, bundle], { stdio: 'pipe' });
      leafSha1 = new X509Certificate(await readFile(`${prefix}0`)).fingerprint.replaceAll(':', '');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  // codesign writes metadata to stderr but the designated requirement to stdout.
  return verifyMacSigning(signing, `${signature.stderr}\n${signature.stdout}`, entitlements.stdout, leafSha1);
}
