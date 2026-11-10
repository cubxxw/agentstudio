import { ChevronDown } from "lucide-react";
import type { AgentConfiguration, AgentProfile } from "./types";

export function AgentOptions({ profile, value, onChange, refreshing, onRefresh }: {
  profile?: AgentProfile | null; value: AgentConfiguration; onChange: (value: AgentConfiguration) => void; refreshing: boolean; onRefresh: () => void;
}) {
  if (!profile?.thinkingLevels.length) return <p className="im-field-hint">模型与运行参数由所连接的服务管理。</p>;
  const provider = value.modelMode === "fixed" ? value.provider || "" : profile.defaults.provider || "";
  const model = value.modelMode === "fixed" ? value.model || "" : profile.defaults.model || "";
  const thinking = value.thinking === "follow" ? profile.modelThinkingLevels?.[`${provider}/${model}`] || profile.defaults.thinking : value.thinking;
  const levels = profile.models.find(item => item.provider === provider && item.id === model)?.thinkingLevels || profile.thinkingLevels;
  return <section className="im-agent-options" data-testid="im-agent-options">
    <div className="im-model-preview"><span>本机默认模型<strong data-testid="im-detected-model">{profile.defaults.model || "由 CLI 决定"}</strong><small>{profile.defaults.provider || "本机配置"}{profile.defaults.thinking ? ` · 思考 ${profile.defaults.thinking}` : ""}</small></span><button type="button" className="im-text-button" disabled={refreshing} onClick={onRefresh} data-testid="im-profile-refresh">{refreshing ? "读取中…" : "重新读取"}</button></div>
    <details open={value.modelMode === "fixed" || value.thinking !== "follow" || !profile.defaults.model || !profile.defaults.thinking || undefined}>
      <summary data-testid="im-model-options-toggle">模型与思考配置<span>{value.modelMode === "follow" ? "跟随本机" : model || "独立选择"}{thinking ? ` · ${thinking}` : ""}</span><ChevronDown size={14} /></summary>
      <div className="im-agent-fields">
        <label>模型选择<select data-testid="im-model-policy" value={value.modelMode} onChange={e => onChange({ ...value, modelMode: e.target.value as AgentConfiguration["modelMode"], ...(e.target.value === "fixed" ? { provider, model } : {}) })}><option value="follow">跟随本机默认模型</option><option value="fixed">为这位联系人单独选择</option></select></label>
        {value.modelMode === "fixed" && (profile.agentId === "pi" ? <label>可用模型<select required value={JSON.stringify([provider, model])} data-testid="im-model-select" onChange={e => { const [nextProvider, nextModel] = JSON.parse(e.target.value); onChange({ ...value, provider: nextProvider, model: nextModel }); }}><option value={JSON.stringify(["", ""])}>请选择模型</option>{profile.models.map(m => <option key={`${m.provider}/${m.id}`} value={JSON.stringify([m.provider, m.id])}>{m.name} · {m.provider}</option>)}</select></label> : <>
          <label>提供商<select data-testid="im-model-provider" value={provider} onChange={e => onChange({ ...value, provider: e.target.value })}>{profile.providers.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
          <label>模型名称<input required maxLength={160} value={model} data-testid="im-model-name" onChange={e => onChange({ ...value, model: e.target.value })} placeholder="填写这位助手支持的模型 ID" /></label>
        </>)}
        <label>思考深度<select data-testid="im-model-thinking" value={value.thinking} onChange={e => onChange({ ...value, thinking: e.target.value })}><option value="follow">跟随该模型的默认深度</option>{!levels.includes(value.thinking) && value.thinking !== "follow" && <option value={value.thinking} disabled>{value.thinking}（当前模型不支持）</option>}{levels.map(level => <option key={level} value={level}>{level === "off" ? "关闭" : level}</option>)}</select></label>
        <p className="im-field-hint">{profile.source}。已接受的消息保留当时的模型，修改从新消息起生效。</p>
      </div>
    </details>
  </section>;
}
