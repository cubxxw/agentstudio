import { APIError, connectionIdentity, digest } from './store.mjs';

const MINUTE = 60_000;
const active = ['queued', 'running', 'verifying', 'needs_input'];
const fail = (message, code = 'bad_request', status = 400) => { throw new APIError(status, code, message); };
const defaults = () => ({ enabled: false, mode: 'interval', intervalMinutes: 60, time: '09:00', timeZone: 'Asia/Shanghai', maxRunsPerDay: 4 });
const formatters = new Map();
function localParts(date, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** At most one slot per local day, including a repeated DST hour. A nonexistent time skips that day. */
export function nextDailyRun(after, time, timeZone) {
  const current = localParts(after, timeZone);
  const start = Math.floor(+after / MINUTE) * MINUTE + MINUTE;
  for (let at = start; at <= start + 3 * 24 * 60 * MINUTE; at += MINUTE) {
    const local = localParts(new Date(at), timeZone);
    if (local.time === time && (local.day > current.day || time > current.time)) return new Date(at).toISOString();
  }
  fail('无法计算这个时区的下一次运行');
}
function nextDay(after, timeZone) {
  const day = localParts(after, timeZone).day;
  for (let at = Math.floor(+after / MINUTE) * MINUTE + MINUTE; at <= +after + 27 * 60 * MINUTE; at += MINUTE) {
    if (localParts(new Date(at), timeZone).day > day) return new Date(at).toISOString();
  }
  fail('无法计算下一天的运行额度');
}
function nextTime(date, scheduler) {
  return scheduler.mode === 'daily' ? nextDailyRun(date, scheduler.time, scheduler.timeZone) : new Date(+date + scheduler.intervalMinutes * MINUTE).toISOString();
}

export function parseGoalDecision(output) {
  let value;
  try { value = JSON.parse(output); } catch { /* Never interpret prose as a scheduling command. */ }
  const invalid = () => fail('Agent 没有返回有效的目标进度；已停止自动续跑，请检查本次记录。', 'invalid_goal_decision', 502);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['reply', 'goalStatus', 'nextRunMinutes', 'reason'].includes(key)) ||
      typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 200_000 ||
      typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000 || !['continue', 'completed', 'needs_input'].includes(value.goalStatus)) invalid();
  if (value.goalStatus === 'continue' ? !Number.isInteger(value.nextRunMinutes) || value.nextRunMinutes < 15 || value.nextRunMinutes > 1440 : value.nextRunMinutes !== null) invalid();
  return { reply: value.reply.trim(), goalStatus: value.goalStatus, nextRunMinutes: value.nextRunMinutes, reason: value.reason.trim() };
}

/** One durable policy per contact; all actual work stays in the existing single worker. */
export class AgentScheduler {
  constructor(store, messenger, options = {}) {
    this.store = store; this.messenger = messenger; this.options = options;
    this.clock = options.clock || (() => new Date()); this.closed = false;
  }
  capability(contactId) {
    const contact = this.messenger.publicContact(this.store.require('contact', contactId));
    const connection = contact.binding?.type === 'connection' ? this.store.get('connection', contact.binding.connectionId) : null;
    const supported = contact.kind === 'agent' && (contact.binding?.type === 'local' ? ['codex', 'claude', 'pi'].includes(contact.binding.localAgentId) : connection?.type === 'a2a');
    return { contact, supported, autonomousSupported: supported && contact.binding.type === 'local',
      unsupportedReason: supported ? '' : contact.kind === 'human' ? '人类联系人没有 Agent 调度器' : '工具连接需要明确的聊天后端，暂不支持自动调度' };
  }
  record(contactId) {
    return this.store.get('agent_control', contactId) || { id: contactId, version: 0, goal: { text: '', status: 'paused' }, scheduler: defaults(), nextRunAt: null, state: 'idle' };
  }
  runs(contactId) {
    return this.store.list('thread').flatMap(thread => thread.runs.filter(run => run.contactId === contactId).map(run => ({ ...run, threadId: thread.id })));
  }
  countToday(contactId, scheduler) {
    const day = localParts(this.clock(), scheduler.timeZone).day;
    return this.runs(contactId).filter(run => run.agentSchedule && localParts(new Date(run.agentSchedule.reservedAt || run.agentSchedule.acceptedAt), scheduler.timeZone).day === day).length;
  }
  get(contactId) {
    const { supported, autonomousSupported, unsupportedReason } = this.capability(contactId), record = this.record(contactId);
    const recent = this.runs(contactId).filter(run => run.agentSchedule).sort((a, b) => b.agentSchedule.acceptedAt.localeCompare(a.agentSchedule.acceptedAt));
    const pending = recent.find(run => active.includes(run.status) && run.agentSchedule.version === record.version);
    return { contactId, version: record.version, goal: record.goal, scheduler: record.scheduler, supported, autonomousSupported, unsupportedReason,
      state: pending ? pending.status === 'queued' ? 'queued' : 'running' : record.state, nextRunAt: record.nextRunAt,
      ...(record.lastRunAt ? { lastRunAt: record.lastRunAt } : {}), ...(record.lastReason ? { lastReason: record.lastReason } : {}),
      runsToday: this.countToday(contactId, record.scheduler), recentRuns: recent.slice(0, 10).map(run => ({ runId: run.id, threadId: run.threadId, status: run.status, createdAt: run.createdAt, ...(run.error ? { error: run.error } : {}) })) };
  }
  save(contactId, body) {
    const previous = this.record(contactId), capability = this.capability(contactId);
    if (body.version !== previous.version) fail('目标或调度已更新，请刷新后再保存', 'version_conflict', 409);
    const goal = body.goal, scheduler = body.scheduler;
    if (!goal || typeof goal.text !== 'string' || goal.text.length > 12000 || !['active', 'paused', 'completed'].includes(goal.status)) fail('请填写有效的目标与目标状态');
    if (!scheduler || typeof scheduler.enabled !== 'boolean' || !['interval', 'daily', 'autonomous'].includes(scheduler.mode) ||
        !Number.isInteger(scheduler.intervalMinutes) || scheduler.intervalMinutes < 15 || scheduler.intervalMinutes > (scheduler.mode === 'autonomous' ? 1440 : 10080) ||
        typeof scheduler.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduler.time) ||
        typeof scheduler.timeZone !== 'string' || scheduler.timeZone.length > 100 || !Number.isInteger(scheduler.maxRunsPerDay) || scheduler.maxRunsPerDay < 1 || scheduler.maxRunsPerDay > 24) fail('请检查调度时间、时区和每日次数（1–24 次）');
    try { localParts(this.clock(), scheduler.timeZone); } catch { fail('请选择有效的 IANA 时区'); }
    if (scheduler.enabled && !capability.supported) fail(capability.unsupportedReason);
    if (scheduler.enabled && scheduler.mode === 'autonomous' && !capability.autonomousSupported) fail('这个 Agent 暂不支持自主决定下一次运行，请选择固定间隔或每天');
    if (scheduler.enabled && (!goal.text.trim() || goal.status !== 'active')) fail('启用调度前，请填写并启用目标');
    if (scheduler.enabled && this.runs(contactId).some(run => this.store.unresolved(run) || run.requiresReconciliation)) fail('原任务结果尚未核查，请先核查再启用调度', 'unknown_execution', 409);
    if (scheduler.enabled && capability.contact.availability !== 'ready') fail('Agent 的连接或登录暂不可用，请处理后再启用', 'agent_unavailable', 409);
    const normalized = Object.fromEntries(Object.keys(defaults()).map(key => [key, scheduler[key]]));
    const record = { ...previous, version: previous.version + 1, goal: { text: goal.text.trim(), status: goal.status }, scheduler: normalized,
      nextRunAt: normalized.enabled ? nextTime(this.clock(), normalized) : null,
      state: goal.status === 'completed' ? 'completed' : goal.status === 'paused' ? 'paused' : normalized.enabled ? 'scheduled' : 'idle', lastReason: '', updatedAt: this.clock().toISOString() };
    this.store.put('agent_control', record);
    this.bindPolicy(contactId, capability.contact);
    return this.get(contactId);
  }
  bindPolicy(contactId, contact) {
    const connection = contact.binding?.type === 'connection' ? this.store.require('connection', contact.binding.connectionId) : null;
    // Private server-owned identity; never exposed in the renderer or prompt.
    this.store.put('schedule_identity', { id: contactId, contactVersion: contact.version, binding: contact.binding || null, connection: connection ? connectionIdentity(connection) : null });
  }
  assertPolicy(contactId, contact) {
    const previous = this.store.get('schedule_identity', contactId);
    const connection = contact.binding?.type === 'connection' ? this.store.require('connection', contact.binding.connectionId) : null;
    if (!previous || JSON.stringify(previous.binding) !== JSON.stringify(contact.binding) || JSON.stringify(previous.connection) !== JSON.stringify(connection ? connectionIdentity(connection) : null)) fail('Agent 的连接身份已变化，请重新保存目标调度配置', 'schedule_identity_changed', 409);
  }
  busy(contactId) {
    return this.runs(contactId).some(run => active.includes(run.status) || this.store.unresolved(run) || run.requiresReconciliation);
  }
  enqueue(contactId, trigger) {
    const record = this.record(contactId), { contact, supported } = this.capability(contactId);
    if (!supported || contact.availability !== 'ready') fail('Agent 暂不可用，尚未发送目标', 'agent_unavailable', 409);
    if (!record.goal.text || record.goal.status !== 'active') fail('请先保存一个启用中的目标');
    this.assertPolicy(contactId, contact);
    if (this.busy(contactId)) fail('这个 Agent 正在处理任务或等待核查，请先处理原任务', 'agent_busy', 409);
    if (this.countToday(contactId, record.scheduler) >= record.scheduler.maxRunsPerDay) fail('已达到这个 Agent 的每日运行次数，请明天再试或调整配置', 'daily_limit', 409);
    const acceptedAt = this.clock().toISOString();
    const slot = trigger === 'timer' ? record.nextRunAt : `manual:${acceptedAt}`;
    const receiptId = digest(`${contactId}:${record.version}:${slot}`);
    const previous = this.store.get('schedule_slot', receiptId);
    if (previous) return { ...previous, control: this.get(contactId) };
    const thread = this.messenger.createChat({ kind: 'direct', memberIds: [contactId] });
    const result = this.messenger.appendMessage(thread, { text: `按自己的目标继续本次工作：\n${record.goal.text}`, attachments: [], memoryIds: [] }, this.options.validateInput);
    const run = result.runs.at(-1), message = result.messages.find(item => item.id === run.messageId);
    run.agentSchedule = { contactId, version: record.version, trigger, slot, acceptedAt, goal: structuredClone(record.goal), mode: record.scheduler.mode, timeZone: record.scheduler.timeZone, maxRunsPerDay: record.scheduler.maxRunsPerDay };
    Object.assign(message, { role: 'system', contactId: null, trigger: 'agent_schedule', text: `${trigger === 'timer' ? '调度器' : '手动运行目标'} · ${contact.name}\n${record.goal.text}` });
    this.store.put('thread', result);
    this.store.put('agent_control', { ...record, state: 'queued', lastRunAt: acceptedAt, nextRunAt: null, lastReason: '' });
    const receipt = { id: receiptId, threadId: thread.id, runId: run.id };
    this.store.put('schedule_slot', receipt);
    return { threadId: thread.id, runId: run.id, control: this.get(contactId) };
  }
  runNow(contactId, body) {
    if (body.version !== this.record(contactId).version) fail('目标或调度已更新，请刷新后再运行', 'version_conflict', 409);
    return this.enqueue(contactId, 'manual');
  }
  beforeRun(thread, run) {
    if (!run.agentSchedule) return true;
    if (run.phase === 'reconcile') return true; // Read back the original task after a policy was paused.
    const snapshot = run.agentSchedule, record = this.record(run.contactId);
    let reason = '';
    if (snapshot.version !== record.version || record.goal.status !== 'active' || (snapshot.trigger === 'timer' && !record.scheduler.enabled)) reason = '目标或调度已调整，旧的排队运行已取消';
    else {
      try { this.assertPolicy(run.contactId, this.capability(run.contactId).contact); }
      catch (error) { reason = error.message; }
      if (this.runs(run.contactId).some(item => item.id !== run.id && (this.store.unresolved(item) || item.requiresReconciliation))) reason = '这个 Agent 的原任务尚未核查，目标运行已取消';
    }
    if (!reason) {
      const today = localParts(this.clock(), record.scheduler.timeZone).day;
      const existingDay = localParts(new Date(snapshot.reservedAt || snapshot.acceptedAt), record.scheduler.timeZone).day;
      if (existingDay !== today && this.countToday(run.contactId, record.scheduler) >= record.scheduler.maxRunsPerDay) reason = '今天的运行次数已用完，本次等待中的目标运行已取消';
      else {
        this.store.updateThread(thread.id, item => { item.runs.find(entry => entry.id === run.id).agentSchedule.reservedAt = this.clock().toISOString(); });
        return true;
      }
    }
    this.store.updateThread(thread.id, item => {
      const selected = item.runs.find(entry => entry.id === run.id);
      selected.status = 'cancelled'; selected.error = reason; selected.finishedAt = this.clock().toISOString();
      this.store.event(item, 'cancelled', reason, { runId: run.id });
    });
    this.afterRun(thread.id, run.id); this.options.notify?.({ threadId: thread.id }); return false;
  }
  afterRun(threadId, runId) {
    const run = this.store.require('thread', threadId).runs.find(item => item.id === runId);
    if (!run?.agentSchedule || active.includes(run.status)) return;
    const record = this.record(run.contactId);
    if (record.version !== run.agentSchedule.version || record.lastProcessedRunId === runId) return;
    const updated = { ...record, lastProcessedRunId: runId, state: 'idle', nextRunAt: null, lastReason: '' };
    if (run.status !== 'completed') { updated.state = 'blocked'; updated.lastReason = run.error || '上次运行未完成，已停止自动调度'; }
    else if (run.agentSchedule.mode === 'autonomous') {
      const decision = run.goalDecision;
      if (!decision || decision.goalStatus === 'needs_input') { updated.state = 'blocked'; updated.lastReason = decision?.reason || '缺少有效的目标进度，自动续跑已停止'; }
      else if (decision.goalStatus === 'completed') { updated.goal = { ...record.goal, status: 'completed' }; updated.scheduler = { ...record.scheduler, enabled: false }; updated.version += 1; updated.state = 'completed'; updated.lastReason = decision.reason; }
      else if (record.scheduler.enabled) { updated.nextRunAt = new Date(+this.clock() + decision.nextRunMinutes * MINUTE).toISOString(); updated.state = 'scheduled'; updated.lastReason = decision.reason; }
    } else if (record.scheduler.enabled) {
      const acceptedDay = localParts(new Date(run.agentSchedule.acceptedAt), record.scheduler.timeZone).day;
      const after = this.clock();
      updated.nextRunAt = nextTime(after, record.scheduler);
      // Completion during a repeated DST hour cannot create a second daily slot.
      if (record.scheduler.mode === 'daily' && localParts(new Date(updated.nextRunAt), record.scheduler.timeZone).day <= acceptedDay) {
        updated.nextRunAt = nextDailyRun(new Date(+new Date(nextDay(after, record.scheduler.timeZone)) - MINUTE), record.scheduler.time, record.scheduler.timeZone);
      }
      updated.state = 'scheduled';
    }
    if (updated.nextRunAt && this.countToday(run.contactId, record.scheduler) >= record.scheduler.maxRunsPerDay) {
      updated.nextRunAt = record.scheduler.mode === 'daily' ? nextDailyRun(this.clock(), record.scheduler.time, record.scheduler.timeZone) : nextDay(this.clock(), record.scheduler.timeZone);
      updated.lastReason = '今天的运行次数已用完，下一天继续';
    }
    this.store.put('agent_control', updated); this.options.notify?.({ contactId: run.contactId });
  }
  recover() {
    for (const record of this.store.list('agent_control')) {
      const latest = this.runs(record.id).filter(run => run.agentSchedule?.version === record.version).sort((a, b) => b.agentSchedule.acceptedAt.localeCompare(a.agentSchedule.acceptedAt))[0];
      if (latest) this.afterRun(latest.threadId, latest.id);
    }
  }
  async tick() {
    if (this.closed || this.ticking) return;
    this.ticking = true;
    try {
      const due = this.store.list('agent_control').filter(record => record.scheduler.enabled && record.goal.status === 'active' && record.nextRunAt && +new Date(record.nextRunAt) <= +this.clock());
      if (!due.length) return;
      await this.options.refresh?.();
      for (const candidate of due) {
        if (this.closed) return;
        const record = this.record(candidate.id);
        if (record.version !== candidate.version || record.nextRunAt !== candidate.nextRunAt) continue;
        if (this.busy(record.id)) continue;
        if (this.countToday(record.id, record.scheduler) >= record.scheduler.maxRunsPerDay) {
          this.store.put('agent_control', { ...record, nextRunAt: record.scheduler.mode === 'daily' ? nextDailyRun(this.clock(), record.scheduler.time, record.scheduler.timeZone) : nextDay(this.clock(), record.scheduler.timeZone), lastReason: '今天的运行次数已用完，下一天继续' }); continue;
        }
        try { this.store.transaction(() => this.enqueue(record.id, 'timer')); }
        catch (error) { this.store.put('agent_control', { ...record, state: 'blocked', nextRunAt: null, lastReason: error.message }); }
      }
      this.options.notify?.({ kind: 'agent_schedule' }); this.options.kick?.();
    } finally { this.ticking = false; }
  }
  start(interval = 30_000) {
    if (!interval) return;
    this.timer = setInterval(() => { this.tick().catch(() => this.options.notify?.({ kind: 'agent_schedule' })); }, interval);
    this.timer.unref();
    this.tick().catch(() => this.options.notify?.({ kind: 'agent_schedule' }));
  }
  async close() { this.closed = true; clearInterval(this.timer); while (this.ticking) await new Promise(resolve => setTimeout(resolve, 10)); }
}
