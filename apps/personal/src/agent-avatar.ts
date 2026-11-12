import { createAvatar } from '@dicebear/core';
import * as bottts from '@dicebear/bottts';
import { defaultAgentAvatar } from '../server/agent-avatar.mjs';
import type { AgentAvatar, AvatarActivity } from './types';

export const avatarPalettes = {
  blue: { label: '研究', color: '#527fce', soft: '#eaf1fc' },
  violet: { label: '创作', color: '#9272c4', soft: '#f1ebf9' },
  orange: { label: '执行', color: '#c9833e', soft: '#fcf0e3' },
  teal: { label: '协作', color: '#388d83', soft: '#e5f4ef' },
  rose: { label: '交流', color: '#bf6f91', soft: '#f9eaf1' },
};
export const activityLabels: Record<AvatarActivity['state'], string> = { idle: '待命', queued: '等待执行', thinking: '正在思考', working: '正在执行', waiting: '等待你处理', completed: '已完成', attention: '需要检查' };
// Bounded cache: changing a name or receiving a token never regenerates an image.
const portraits = new Map<string, string>();
export function robotAvatarUrl(config: AgentAvatar) {
  const key = JSON.stringify(config);
  const cached = portraits.get(key);
  if (cached) return cached;
  const color = avatarPalettes[config.palette].color.slice(1);
  const avatar = createAvatar(bottts, { seed: config.seed, size: 128, backgroundColor: ['transparent'], baseColor: [color], eyes: [config.eyes], mouth: [config.mouth], top: [config.top], topProbability: 100, sidesProbability: 65, textureProbability: 0 });
  const url = avatar.toDataUri();
  if (portraits.size >= 256) portraits.delete(portraits.keys().next().value!);
  portraits.set(key, url);
  return url;
}
export { defaultAgentAvatar };

let visibilityObserver: IntersectionObserver | undefined;
export function observeAvatar(node: HTMLSpanElement | null) {
  if (!node || typeof IntersectionObserver === 'undefined') return;
  visibilityObserver ||= new IntersectionObserver(entries => {
    for (const entry of entries) (entry.target as HTMLElement).dataset.avatarVisible = String(entry.isIntersecting);
  }, { rootMargin: '32px' });
  visibilityObserver.observe(node);
  return () => visibilityObserver?.unobserve(node);
}
