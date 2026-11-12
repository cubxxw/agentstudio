export type AgentAvatar = { version: 1; style: 'bottts'; seed: string; palette: 'blue' | 'violet' | 'orange' | 'teal' | 'rose'; eyes: 'round' | 'happy' | 'eva' | 'robocop'; mouth: 'smile01' | 'smile02' | 'grill01' | 'diagram'; top: 'antenna' | 'radar' | 'pyramid' | 'glowingBulb01'; motion: boolean };
export type AvatarActivity = { state: 'idle' | 'queued' | 'thinking' | 'working' | 'waiting' | 'completed' | 'attention'; runId?: string; completedAt?: string };
export const avatarChoices: { [K in 'palette' | 'eyes' | 'mouth' | 'top']: AgentAvatar[K][] };
export function defaultAgentAvatar(contact?: { id?: string; handle?: string; name?: string; description?: string; icon?: string; color?: string }): AgentAvatar;
export function normalizeAgentAvatar(value: unknown): AgentAvatar;
export function agentAvatarActivity(runs?: { id: string; status: string; createdAt?: string; finishedAt?: string; stopUnconfirmed?: boolean; cancelPending?: boolean; requiresReconciliation?: boolean; progress?: { phase: string } }[], decisions?: { runId?: string; state: string }[], remote?: { running?: number; waiting?: number }): AvatarActivity;
