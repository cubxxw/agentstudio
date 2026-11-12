import { useState, type CSSProperties } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { Avatar } from './ContactAvatar';
import { avatarPalettes, activityLabels } from './agent-avatar';
import { avatarChoices } from '../server/agent-avatar.mjs';
import type { AgentAvatar, AvatarActivity } from './types';

const eyesLabels = ['圆眼', '笑眼', '屏幕', '护目镜'];
const mouthLabels = ['微笑', '开怀', '格栅', '声波'];
const topLabels = ['天线', '雷达', '棱角', '灯泡'];
export function AgentAvatarEditor({ value, name, onChange }: { value: AgentAvatar; name: string; onChange: (avatar: AgentAvatar) => void }) {
  const [candidates, setCandidates] = useState(() => [value.seed, ...Array.from({ length: 3 }, (_, i) => `${value.seed.slice(0, 80)}:candidate:0:${i}`)]);
  const [preview, setPreview] = useState<AvatarActivity['state']>('thinking');
  const contact = (avatar: AgentAvatar) => ({ kind: 'agent' as const, name: name || '新伙伴', color: avatar.palette, avatar });
  return <section className="im-agent-appearance" data-testid="im-agent-appearance" aria-label="Agent 头像">
    <div className="im-avatar-studio">
      <div className="im-avatar-studio-preview" data-testid="im-avatar-preview"><Avatar contact={contact(value)} size="hero" activity={{ state: preview, runId: preview, completedAt: preview === 'completed' ? new Date().toISOString() : undefined }} /></div>
      <div className="im-avatar-studio-copy"><strong>给这位伙伴一个样子</strong><p>选定后一直保留。工作时，状态会亮起来。</p><span className={`im-avatar-preview-status ${preview}`}><i />{activityLabels[preview]}</span></div>
    </div>
    <div className="im-avatar-candidate-heading"><span>选择外观</span><button type="button" className="im-text-button" data-testid="im-avatar-regenerate" onClick={() => setCandidates([value.seed, ...Array.from({ length: 3 }, () => crypto.randomUUID())])}><RefreshCw size={13} />换一组</button></div>
    <div className="im-avatar-candidates" aria-label="头像候选">{candidates.map((seed, i) => <button type="button" key={seed} aria-label={`头像候选 ${i + 1}`} aria-pressed={value.seed === seed} data-testid={`im-avatar-candidate-${i}`} onClick={() => onChange({ ...value, seed })}><Avatar contact={contact({ ...value, seed })} size="large" activity={{ state: 'idle' }} />{value.seed === seed && <span className="im-avatar-candidate-check"><Check size={12} /></span>}</button>)}</div>
    <div className="im-avatar-palette-row" aria-label="角色配色">{Object.entries(avatarPalettes).map(([id, palette]) => <button type="button" key={id} style={{ '--palette': palette.color } as CSSProperties} aria-pressed={value.palette === id} data-testid={`im-avatar-palette-${id}`} onClick={() => onChange({ ...value, palette: id as AgentAvatar['palette'] })}><i>{value.palette === id && <Check size={12} />}</i>{palette.label}</button>)}</div>
    <div className="im-avatar-features">{(['eyes', 'mouth', 'top'] as const).map((field, i) => <label key={field}>{['眼睛', '表情', '头饰'][i]}<select value={value[field]} data-testid={`im-avatar-${field}`} onChange={e => onChange({ ...value, [field]: e.target.value })}>{avatarChoices[field].map((option, j) => <option value={option} key={option}>{[eyesLabels, mouthLabels, topLabels][i]![j]}</option>)}</select></label>)}</div>
    <div className="im-avatar-motion-heading"><label><input type="checkbox" checked={value.motion} data-testid="im-avatar-motion" onChange={e => onChange({ ...value, motion: e.target.checked })} />状态动效</label><small>跟随实际进度，也遵循系统减少动态效果</small></div>
    <div className="im-avatar-state-preview" aria-label="动效预览">{(['idle', 'thinking', 'working', 'waiting', 'completed'] as const).map(state => <button type="button" key={state} aria-pressed={preview === state} data-testid={`im-avatar-state-${state}`} onClick={() => setPreview(state)}>{state === 'idle' ? '待命' : state === 'thinking' ? '思考' : state === 'working' ? '执行' : state === 'waiting' ? '待处理' : '完成'}</button>)}</div>
    <p className="im-field-hint">预览仅展示动效，不会启动任务或执行操作。</p>
  </section>;
}
