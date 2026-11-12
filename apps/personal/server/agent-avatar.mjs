// Shared with the renderer. No IO, URLs or user-provided markup.
export const avatarChoices = Object.freeze({
  palette: ['blue', 'violet', 'orange', 'teal', 'rose'],
  eyes: ['round', 'happy', 'eva', 'robocop'],
  mouth: ['smile01', 'smile02', 'grill01', 'diagram'],
  top: ['antenna', 'radar', 'pyramid', 'glowingBulb01'],
});
export function defaultAgentAvatar(contact = {}) {
  const role = `${contact.name || ''} ${contact.description || ''} ${contact.icon || ''}`;
  const palette = /研究|research|分析|search/i.test(role) ? 'blue' : /创作|写作|设计|creative|write|design/i.test(role) ? 'violet' : /执行|工程|开发|代码|execution|code/i.test(role) ? 'orange' : avatarChoices.palette.includes(contact.color) ? contact.color : 'teal';
  return { version: 1, style: 'bottts', seed: `agentroom:${contact.id || contact.handle || 'new-agent'}`, palette, eyes: 'round', mouth: 'smile01', top: 'antenna', motion: true };
}
export function normalizeAgentAvatar(value) {
  const bad = () => { throw new Error('请选择支持的 Agent 头像外观'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad();
  const keys = ['version', 'style', 'seed', 'palette', 'eyes', 'mouth', 'top', 'motion'];
  if (Object.keys(value).some(key => !keys.includes(key)) || value.version !== 1 || value.style !== 'bottts') bad();
  if (typeof value.seed !== 'string' || !value.seed.trim() || value.seed.length > 128 || /[\x00-\x1f\x7f]/.test(value.seed)) bad();
  for (const [key, choices] of Object.entries(avatarChoices)) if (!choices.includes(value[key])) bad();
  if (value.motion !== undefined && typeof value.motion !== 'boolean') bad();
  return { version: 1, style: 'bottts', seed: value.seed.trim(), palette: value.palette, eyes: value.eyes, mouth: value.mouth, top: value.top, motion: value.motion !== false };
}
export function agentAvatarActivity(runs = [], decisions = [], remote = {}) {
  const ordered = runs.map((run, index) => ({ run, index })).sort((a, b) => (Date.parse(b.run.createdAt) || 0) - (Date.parse(a.run.createdAt) || 0) || b.index - a.index).map(item => item.run);
  const uncertain = ordered.find(run => run.stopUnconfirmed || run.cancelPending || run.requiresReconciliation || run.status === 'unknown');
  if (uncertain) return { state: 'attention', runId: uncertain.id };
  if (remote.waiting > 0) return { state: 'waiting' };
  const card = decisions.find(d => ['pending', 'sending', 'unknown'].includes(d.state));
  if (card) return { state: 'waiting', ...(card.runId ? { runId: card.runId } : {}) };
  const waiting = ordered.find(run => run.status === 'needs_input' || decisions.some(d => d.runId === run.id && ['pending', 'sending', 'unknown'].includes(d.state)));
  if (waiting) return { state: 'waiting', runId: waiting.id };
  const active = ordered.find(run => ['running', 'verifying'].includes(run.status));
  if (active) return { state: active.status === 'running' && active.progress?.phase === 'thinking' ? 'thinking' : 'working', runId: active.id };
  if (remote.running > 0) return { state: 'working' };
  const queued = ordered.find(run => run.status === 'queued');
  if (queued) return { state: 'queued', runId: queued.id };
  const last = ordered[0];
  if (last?.status === 'completed') return { state: 'completed', runId: last.id, completedAt: last.finishedAt };
  return { state: last && ['failed', 'blocked'].includes(last.status) ? 'attention' : 'idle', ...(last ? { runId: last.id } : {}) };
}
