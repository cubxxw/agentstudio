// Opt-in local acceptance against the installed Grok Bot's offline avatar code.
// Does not load an account, contact the service or change the installed app.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.AGENTSTUDIO_AVATAR_EVIDENCE;
if (!output || !process.argv.includes('--installed-app')) throw new Error('Use --installed-app and AGENTSTUDIO_AVATAR_EVIDENCE=<registered artifact directory>.');
await mkdir(output, { recursive: true });
const requireDesktop = createRequire(join(root, 'apps/desktop/package.json'));
const requireVite = createRequire(requireDesktop.resolve('vite'));
const { rolldown } = await import(requireVite.resolve('rolldown'));
const bundle = await rolldown({ input: join(root, 'apps/desktop/src/main/connectors/grokavatar.ts'), platform: 'node', external: ['electron', /^node:/] });
const modulePath = join(output, 'grokavatar.cjs');
await bundle.write({ file: modulePath, format: 'cjs' });
await bundle.close();
const harness = join(output, 'avatar-harness.cjs');
await writeFile(harness, `
const { app, nativeImage, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { writeFileSync, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { grokAvatar } = require(${JSON.stringify(modulePath)});
const output = ${JSON.stringify(output)};
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const checks = [];
  try {
    for (const [shape, color] of [['blob','violet'], ['square','orange'], ['heart','green']]) {
      const avatar = await grokAvatar({ id: 'synthetic-get-499', avatarShape: shape, avatarColor: color }, app.getPath('userData'));
      if (!avatar) throw new Error('No avatar for ' + shape + ':' + color);
      const image = nativeImage.createFromBuffer(avatar.data);
      if (image.isEmpty() || image.getSize().width !== 256) throw new Error('Invalid raster avatar');
      writeFileSync(join(output, shape + '-' + color + '.png'), avatar.data);
      checks.push({ shape, color, bytes: avatar.data.length, sha256: createHash('sha256').update(avatar.data).digest('hex') });
    }
    if (new Set(checks.map(check => check.sha256)).size !== checks.length) throw new Error('Distinct bots have the same image');
    const secondProfile = join(output, 'second-profile');
    await grokAvatar({ id: 'another-synthetic-bot', avatarShape: 'heart', avatarColor: 'green' }, secondProfile);
    if (!existsSync(join(secondProfile, 'grokbot-shapes', 'version'))) throw new Error('Avatar cache crossed profile boundaries');
    if (BrowserWindow.getAllWindows().length) throw new Error('Avatar extraction left a window open');
    writeFileSync(join(output, 'avatar-results.json'), JSON.stringify({ passed: true, checks }, null, 2));
    console.log(JSON.stringify({ passed: true, checks }));
    app.exit(0);
  } catch (error) {
    console.error(error.message); app.exit(1);
  }
});
`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(requireDesktop('electron'), [harness], { env, stdio: 'inherit' });
const timeout = setTimeout(() => child.kill('SIGTERM'), 60_000);
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
clearTimeout(timeout);
process.exitCode = code === 0 ? 0 : 1;
