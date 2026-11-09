import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { mkdirSync, chmodSync, lstatSync, readFileSync, readdirSync, openSync, writeFileSync, fsyncSync, closeSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { APIError } from './store.mjs';

const unavailable = () => new APIError(503, 'credential_vault_unavailable', '本机凭据库或密钥无法读取。原文件已保留，请修复后再试；不会生成新密钥覆盖原凭据。');
const bindingFor = (connection) => ({ connectionId: connection.id, type: connection.type, url: connection.url, version: connection.credentialVersion || 1 });

export function validateBearerToken(token) {
  if (token === undefined || token === '') return null;
  if (typeof token !== 'string' || token.length < 8 || token.length > 8000 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new APIError(400, 'invalid_bearer_token', 'Bearer token 必须是 8–8000 个可见 ASCII 字符，不能包含空格、换行或控制字符');
  }
  return token;
}

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

// Immutable creation through an exclusive hard link: no existing key/credential
// can be overwritten, including when fsync or creation fails midway.
function durableCreate(directory, filename, bytes) {
  const temporary = join(directory, `.new-${randomUUID()}`), target = join(directory, filename);
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    linkSync(temporary, target); syncDirectory(directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); syncDirectory(directory); } catch { /* keep the original durable file on cleanup failure */ }
  }
}

export class CredentialVault {
  constructor(dataDir) {
    this.directory = join(dataDir, 'vault'); this.recordsDirectory = join(this.directory, 'credentials');
    this.keyPath = join(this.directory, 'master.key'); this.secrets = new Set(); this.blocked = false;
    for (const directory of [this.directory, this.recordsDirectory]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw unavailable();
      chmodSync(directory, 0o700);
    }
    const records = this.recordNames();
    try {
      if (records.length) for (const name of records) this.decrypt(this.readRecord(name.slice(0, -5)));
      else if (this.keyExists()) this.loadKey();
    } catch { this.blocked = true; }
  }

  recordNames() { return readdirSync(this.recordsDirectory).filter((name) => /^cred_[a-f0-9-]+\.json$/.test(name)); }

  keyExists() {
    try { lstatSync(this.keyPath); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw unavailable(); }
  }

  assertPrivateLocation() {
    const root = spawnSync('git', ['-C', this.directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 3000 });
    if (root.error) throw new APIError(503, 'vault_location_unverified', '无法核对凭据库的 Git 排除状态，未生成密钥');
    if (root.status !== 0) return;
    const ignored = spawnSync('git', ['-C', root.stdout.trim(), 'check-ignore', '--quiet', '--', this.keyPath], { encoding: 'utf8', timeout: 3000 });
    if (ignored.status !== 0) throw new APIError(400, 'unsafe_vault_location', '凭据库必须位于 Git 已忽略的目录或仓库之外；未生成密钥');
  }

  loadKey(create = false) {
    if (this.blocked) throw unavailable();
    if (!this.keyExists()) {
      if (!create || this.recordNames().length) throw unavailable();
      this.assertPrivateLocation();
      durableCreate(this.directory, 'master.key', randomBytes(32));
    }
    try {
      const info = lstatSync(this.keyPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== 32) throw unavailable();
      chmodSync(this.keyPath, 0o600);
      const key = readFileSync(this.keyPath);
      if (key.length !== 32) throw unavailable();
      return key;
    } catch { throw unavailable(); }
  }

  fingerprint(token, type, url) { return createHmac('sha256', this.loadKey(true)).update(JSON.stringify({ token, type, url })).digest('hex'); }

  recordPath(ref) {
    if (!/^cred_[a-f0-9-]+$/.test(ref)) throw unavailable();
    return join(this.recordsDirectory, `${ref}.json`);
  }

  readRecord(ref) {
    try {
      const path = this.recordPath(ref), info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 24_000) throw unavailable();
      chmodSync(path, 0o600);
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (record.format !== 1 || record.ref !== ref || !record.binding) throw unavailable();
      return record;
    } catch { throw unavailable(); }
  }

  decrypt(record) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.loadKey(), Buffer.from(record.iv, 'base64'));
      decipher.setAAD(Buffer.from(JSON.stringify(record.binding))); decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      const clear = JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString());
      const token = validateBearerToken(clear.token);
      if (!token) throw unavailable();
      this.secrets.add(token); return token;
    } catch { throw unavailable(); }
  }

  create(token, connection) {
    const ref = `cred_${randomUUID()}`, binding = bindingFor(connection), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.loadKey(true), iv);
    cipher.setAAD(Buffer.from(JSON.stringify(binding)));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ token })), cipher.final()]);
    const record = { format: 1, ref, binding, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
    durableCreate(this.recordsDirectory, `${ref}.json`, JSON.stringify(record));
    this.secrets.add(token); return ref;
  }

  authorization(connection) {
    if (!connection.credentialRef) return {};
    const record = this.readRecord(connection.credentialRef);
    if (JSON.stringify(record.binding) !== JSON.stringify(bindingFor(connection))) throw new APIError(409, 'credential_binding_changed', '连接的凭据身份绑定已改变，请重新建立连接并核对');
    return { Authorization: `Bearer ${this.decrypt(record)}` };
  }

  redactString(value) {
    let result = value;
    for (const token of [...this.secrets].sort((a, b) => b.length - a.length)) result = result.replaceAll(token, '[REDACTED]');
    return result;
  }

  redact(value) {
    if (typeof value === 'string') return this.redactString(value);
    if (Array.isArray(value)) return value.map((entry) => this.redact(entry));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [this.redactString(key), this.redact(entry)]));
    return value;
  }

  remove(ref) {
    try { unlinkSync(this.recordPath(ref)); syncDirectory(this.recordsDirectory); }
    catch (error) { if (error.code !== 'ENOENT') throw new APIError(503, 'credential_cleanup_pending', '连接已移除，但本机加密凭据清理未完成；重试删除可继续清理'); }
  }

  removeForConnection(connectionId) {
    for (const name of this.recordNames()) {
      const ref = name.slice(0, -5), record = this.readRecord(ref);
      if (record.binding.connectionId === connectionId) this.remove(ref);
    }
  }

  close() { this.secrets.clear(); }
}
