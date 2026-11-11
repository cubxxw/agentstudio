import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { APIError } from './store.mjs';

const fingerprint = value => createHash('sha256').update(value).digest();
const fail = (status, code, message) => { throw new APIError(status, code, message); };

/** Private tool transport, separate from renderer API. Policy stays in its handler. */
export class ToolSessions {
  constructor() {
    this.sessions = new Map();
    this.server = createServer((request, response) => { void this.handle(request, response); });
    this.server.requestTimeout = 15000; this.server.headersTimeout = 10000;
  }
  async listen() {
    if (this.closed) throw new Error('Tool broker is closed');
    if (this.listenPromise) return this.listenPromise;
    if (this.server.listening) return;
    this.listenPromise = new Promise((resolve, reject) => {
      const fail = error => { this.server.off('listening', ready); reject(error); };
      const ready = () => { this.server.off('error', fail); resolve(); };
      this.server.once('error', fail); this.server.once('listening', ready);
      try { this.server.listen(0, '127.0.0.1'); }
      catch (error) { this.server.off('error', fail); fail(error); }
    }).finally(() => { this.listenPromise = null; });
    return this.listenPromise;
  }
  open(context, tools, handler, { validate = () => {}, retainResult = () => true } = {}) {
    if (this.closed || !this.server.listening) throw new Error('Tool broker is not listening');
    const key = randomBytes(24).toString('hex'), token = randomBytes(32).toString('base64url');
    const controller = new AbortController();
    const entry = { context: Object.freeze(structuredClone(context)), tools: structuredClone(tools), handler, validate, retainResult, controller,
      tokenHash: fingerprint(token), expires: Date.now() + 30 * 60000, calls: new Map() };
    this.sessions.set(key, entry);
    return { endpoint: `http://127.0.0.1:${this.server.address().port}/s/${key}`, token, toolNames: tools.map(tool => tool.name),
      close: () => { this.sessions.delete(key); controller.abort(); } };
  }
  async handle(request, response) {
    const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
    try {
      if (request.headers.origin || request.headers.host !== `127.0.0.1:${this.server.address().port}`) fail(403, 'invalid_origin', '工具接口仅接受本机执行器');
      const match = /^\/s\/([a-f0-9]{48})$/.exec(request.url || '');
      const entry = match && this.sessions.get(match[1]);
      const authorization = request.headers.authorization;
      if (!entry || entry.expires < Date.now() || !authorization?.startsWith('Bearer ') || !timingSafeEqual(entry.tokenHash, fingerprint(authorization.slice(7)))) fail(401, 'invalid_session', '本次工具会话已经失效');
      if (request.method === 'GET') return send(200, { tools: entry.tools });
      if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') fail(400, 'invalid_request', '需要 JSON 工具调用');
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 2_000_000) fail(413, 'input_limit', '工具输入超过上限'); chunks.push(chunk); }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'invalid_json', '工具输入不是有效 JSON'); }
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['name', 'arguments', 'callId'].includes(k)) || typeof input.callId !== 'string' || !input.callId || input.callId.length > 200 || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) fail(400, 'invalid_request', '工具调用缺少名称、参数或调用标识');
      if (!entry.tools.some(tool => tool.name === input.name)) fail(403, 'tool_unavailable', '本次会话没有这个工具');
      entry.validate(entry.context, input.name, input.arguments, input.callId);
      const hash = fingerprint(JSON.stringify({ name: input.name, arguments: input.arguments })).toString('hex');
      const previous = entry.calls.get(input.callId);
      if (previous && previous.hash !== hash) fail(409, 'idempotency_conflict', '同一工具调用标识的参数发生变化');
      if (!previous && entry.calls.size >= 200) fail(429, 'budget_exceeded', '工具调用预算已用完');
      const record = previous || { hash, result: null }; if (!previous) entry.calls.set(input.callId, record);
      if (!record.result) {
        record.result = Promise.resolve().then(() => {
          if (entry.controller.signal.aborted) fail(401, 'invalid_session', '本次工具会话已经失效');
          return entry.handler({ ...entry.context, signal: entry.controller.signal }, input.name, input.arguments, input.callId);
        }).then(result => { if (!entry.retainResult(input.name)) record.result = null; return result; });
      }
      const result = await record.result;
      entry.validate(entry.context, input.name, input.arguments, input.callId);
      send(200, { result });
    } catch (error) { send(error.status || 500, { error: { code: error.code || 'tool_failed', message: error.status ? error.message : '工具执行未完成，请查看运行记录' } }); }
  }
  async close() {
    this.closed = true;
    await this.listenPromise?.catch(() => {});
    for (const entry of this.sessions.values()) entry.controller.abort();
    this.sessions.clear(); this.server.closeAllConnections();
    if (this.server.listening) await new Promise(resolve => this.server.close(resolve));
  }
}
