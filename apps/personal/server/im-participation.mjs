import { APIError, now } from './store.mjs';

export const REACTIONS = Object.freeze(['👍', '❤️', '😂', '🎉', '🤔', '👀', '✅']);
export const imSettings = store => store.get('setting', 'im') || { id: 'im', version: 0, allowSilence: true };
export const hasIMPolicy = run => Boolean(run.contactId && run.imPolicy && !run.collaboration && !run.agentSchedule);
export const strictParticipation = run => run.responsePolicy === 'auto' && run.conversationSnapshot?.kind === 'group' && run.mode === 'codex';

export function participationDecision(output, run) {
  let decision;
  try { decision = JSON.parse(output); } catch { /* Markdown remains valid in ordinary direct/explicit chat. */ }
  const strict = strictParticipation(run);
  if (!strict && (!hasIMPolicy(run) || !decision || !['reply', 'reaction', 'silence'].includes(decision.action))) return { action: 'reply', text: output };
  const invalid = () => { throw new APIError(502, 'invalid_participation_decision', 'Agent 没有返回有效的 IM 参与决定；未发布回复，也未将失败当作静默。'); };
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) invalid();
  if (decision.action === 'reply' && Object.keys(decision).every(key => ['action', 'text'].includes(key)) && typeof decision.text === 'string' && decision.text.trim() && decision.text.length <= 200_000) return { action: 'reply', text: decision.text.trim() };
  if (decision.action === 'reaction' && Object.keys(decision).every(key => ['action', 'emoji'].includes(key)) && REACTIONS.includes(decision.emoji)) return { action: 'reaction', emoji: decision.emoji };
  if (decision.action === 'silence' && Object.keys(decision).every(key => ['action', 'reason'].includes(key)) && typeof decision.reason === 'string' && decision.reason.trim() && decision.reason.length <= 1000) {
    if (run.imPolicy?.allowSilence === false || run.responsePolicy === 'always') throw new APIError(502, 'silence_disabled', '本次 IM 设置不允许静默，Agent 尚未给出有效回应');
    return { action: 'silence', reason: decision.reason.trim() };
  }
  invalid();
}

export function audienceForRun(thread, run) {
  const inputIndex = thread.messages.findIndex(message => message.id === run.messageId);
  return (run.participantSnapshot || []).map(peer => peer.id).filter(contactId => {
    if (!thread.memberIds) return true;
    if (!thread.memberIds.includes(contactId)) return false;
    const membership = thread.members?.find(member => member.contactId === contactId);
    const accepted = run.participantMemberships?.find(member => member.contactId === contactId);
    if (accepted?.membershipId && membership?.membershipId !== accepted.membershipId) return false;
    if (!membership?.visibleAfterMessageId) return true;
    const boundary = thread.messages.findIndex(message => message.id === membership.visibleAfterMessageId);
    return boundary >= 0 && boundary < inputIndex;
  });
}

export function addReaction(message, reaction) {
  message.reactions ||= [];
  if (!message.reactions.some(existing => existing.contactId === reaction.contactId && existing.emoji === reaction.emoji)) message.reactions.push(reaction);
}

export function acknowledgeInput(thread, run) {
  if (!run.inputReceipt) return;
  run.inputReceipt = { ...run.inputReceipt, state: 'acknowledged', acknowledgedAt: now() };
  const membership = thread.members?.find(member => member.contactId === run.contactId);
  if (!membership || !audienceForRun(thread, run).includes(run.contactId)) return;
  const previous = thread.messages.findIndex(message => message.id === membership.lastReadMessageId);
  const current = thread.messages.findIndex(message => message.id === run.messageId);
  if (current >= previous) membership.lastReadMessageId = run.messageId;
}
