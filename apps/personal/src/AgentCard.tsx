import type { Contact } from "./types";
import "./agent-card.css";

/** Configuration and adapter facts only; never a model/usage verification claim. */
export function AgentCard({ contact }: { contact: Contact }) {
  const binding = contact.connectionType === "mcp" ? contact.chatBackend : contact.binding;
  const local = binding?.type === "local";
  const backend = binding?.type === "local" ? binding.localAgentId : null;
  const supported = backend !== null && ["codex", "claude", "pi"].includes(backend);
  const configuration = contact.execution;
  const capabilities = supported ? ["文字对话", "独立会话上下文", "停止本机执行", ...(["codex", "pi"].includes(backend!) ? ["正文进度"] : [])] : [];
  return <section className="im-agent-card" data-testid="im-agent-card" aria-label={`${contact.name}的名片`}>
    <div className="im-agent-card-heading"><h3>Agent 名片</h3><span>我的助手</span></div>
    <dl>
      <div><dt>所有者</dt><dd>我</dd></div>
      <div><dt>运行位置</dt><dd>{local ? "这台 Mac" : "已连接的服务"}</dd></div>
      <div><dt>{contact.connectionType === "mcp" ? "工具接入" : "接入"}</dt><dd>{contact.providerName || "尚未确认"}</dd></div>
      {contact.connectionType === "mcp" && backend && <div><dt>对话助手</dt><dd>{backend}</dd></div>}
      <div><dt>模型</dt><dd data-testid="im-agent-card-model">{configuration?.model || (local ? "尚未确认，请完善配置" : "由服务管理，尚未确认")}</dd></div>
      {configuration?.provider && <div><dt>模型提供商</dt><dd>{configuration.provider}</dd></div>}
      <div><dt>思考深度</dt><dd>{configuration?.thinking || "尚未确认"}</dd></div>
      {local && <div><dt>配置方式</dt><dd>{contact.configuration?.modelMode === "fixed" ? "固定模型" : "跟随本机默认"}{contact.configuration?.thinking && contact.configuration.thinking !== "follow" ? " · 独立思考深度" : " · 跟随默认深度"}</dd></div>}
      <div><dt>账号额度</dt><dd data-testid="im-agent-card-quota">暂不可获取</dd></div>
      <div><dt>使用范围</dt><dd>仅自己使用</dd></div>
    </dl>
    <div className="im-agent-card-capabilities" data-testid="im-agent-card-capabilities">{capabilities.length ? capabilities.map(item => <span key={item}>{item}</span>) : <span>接入能力尚未确认</span>}</div>
    <p>模型和思考深度是下次对话的配置；实际执行结果以该次回复记录为准。思考深度不代表跨模型的能力评分。</p>
    <p>当前接入尚未提供额度数据。同一账号下的多个 Agent 可能共用额度。</p>
    {contact.configurationError && <p className="im-agent-card-warning">{contact.configurationError}</p>}
  </section>;
}
