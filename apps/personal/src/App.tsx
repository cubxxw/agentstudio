import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Download,
  FileText,
  FolderOpen,
  History,
  Info,
  Loader2,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Unplug,
  WifiOff,
  X,
} from "lucide-react";
import { api, key } from "./api";
import { RichText } from "./Markdown";
import type {
  Artifact,
  Attachment,
  Bootstrap,
  Connection,
  Decision,
  Mode,
  Status,
  Thread,
  ThreadSummary,
} from "./types";

const statusText: Record<Status, string> = {
  queued: "已排队",
  running: "正在处理",
  needs_input: "等你决定",
  blocked: "需要恢复",
  verifying: "正在核验",
  completed: "已完成",
  failed: "未完成",
  cancelled: "已停止",
  unknown: "结果待核查",
};
const attention = (status: Status) =>
  ["needs_input", "blocked", "failed", "unknown"].includes(status);
const active = (status: Status) =>
  ["queued", "running", "verifying"].includes(status);
type Draft = {
  text: string;
  attachments: Attachment[];
  mode: Mode;
  connectionId: string;
  requestId?: string;
  signature?: string;
  memoryIds?: string[];
};
const emptyDraft = (): Draft => ({
  text: "",
  attachments: [],
  mode: "codex",
  connectionId: "",
});
const storage = {
  get<T>(name: string, fallback: T): T {
    try {
      const item = localStorage.getItem(`agentstudio.personal.${name}`);
      return item ? (JSON.parse(item) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(name: string, value: unknown) {
    try {
      localStorage.setItem(
        `agentstudio.personal.${name}`,
        JSON.stringify(value),
      );
    } catch {
      /* A full browser store must not prevent a send. */
    }
  },
};
const initialId = () =>
  new URL(location.href).searchParams.get("thread") ||
  (location.hash.startsWith("#thr_")
    ? decodeURIComponent(location.hash.slice(1))
    : null);
const date = (value: string) =>
  new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.name === "TimeoutError"
      ? "连接超时。内容已保留，再试时会核对同一请求。"
      : error instanceof TypeError && /fetch|network/i.test(error.message)
        ? "连接中断，内容已保留。再试时会核对同一个请求。"
        : error.message
    : "暂时无法连接。内容已保留，可以稍后再试。";

function StatusMark({
  status,
  label = true,
}: {
  status: Status;
  label?: boolean;
}) {
  const Icon = active(status)
    ? status === "queued"
      ? Clock3
      : Loader2
    : status === "completed"
      ? CheckCircle2
      : attention(status)
        ? Circle
        : Square;
  return (
    <span className={`status-mark status-${status}`}>
      <Icon
        size={14}
        className={
          status === "running" || status === "verifying" ? "working" : undefined
        }
      />
      {label && statusText[status]}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      data-testid="personal-modal"
      className={`modal ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <h2>{title}</h2>
          <button
            className="icon-button"
            data-testid="personal-modal-close"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

function Reader({
  artifact,
  sources,
  onClose,
}: {
  artifact: Artifact;
  sources: Attachment[];
  onClose: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [large, setLarge] = useState(storage.get("large-type", false));
  const [source, setSource] = useState<Attachment | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    api<Artifact>(`/artifacts/${artifact.id}`)
      .then((result) => {
        if (current) setBody(result.body ?? "");
      })
      .catch((e) => {
        if (current) setError(errorText(e));
      });
    return () => {
      current = false;
    };
  }, [artifact.id]);
  useEffect(() => {
    if (body !== null && scroll.current)
      scroll.current.scrollTop = storage.get(`reader.${artifact.id}`, 0);
  }, [body, artifact.id]);
  return (
    <Modal
      title={artifact.title}
      onClose={onClose}
      className={`reader-modal${large ? " large-type" : ""}`}
    >
      <div className="reader-toolbar">
        <span>
          <FileText size={14} /> Markdown
        </span>
        <div>
          <button
            className="text-button"
            data-testid="personal-reader-font"
            aria-pressed={large}
            onClick={() => {
              setLarge(!large);
              storage.set("large-type", !large);
            }}
          >
            字号 {large ? "大" : "标准"}
          </button>
          <a
            className="text-button"
            data-testid="personal-reader-download"
            href={`/api/artifacts/${artifact.id}/download`}
            download
          >
            <Download size={15} />
            下载原文
          </a>
        </div>
      </div>
      <div
        className="reader-scroll"
        ref={scroll}
        data-testid="personal-reader"
        onScroll={(event) =>
          storage.set(`reader.${artifact.id}`, event.currentTarget.scrollTop)
        }
      >
        {error ? (
          <p role="alert" className="error-text">
            {error}
          </p>
        ) : body === null ? (
          <p className="muted">
            <Loader2 size={16} className="working" /> 正在打开原文…
          </p>
        ) : (
          <RichText
            text={body}
            reading
            onSource={(id) => {
              const found = sources.find((item) => item.id === id);
              if (found) setSource(found);
              else
                setSourceError(
                  "这处引用没有对应的已保存资料，报告仍可继续阅读。",
                );
            }}
          />
        )}
        {sourceError && (
          <p className="error-text" role="alert">
            {sourceError}
          </p>
        )}
        <footer className="verification">
          <ShieldCheck size={16} />
          <div>
            <strong>
              {artifact.verifiedAt ? "文件已读回校验" : "尚无文件校验证据"}
            </strong>
            <p>校验说明保存的文件字节一致；内容判断仍可在对话中继续修订。</p>
            <details>
              <summary>查看文件指纹</summary>
              <code>{artifact.sha256}</code>
              <p>
                {artifact.size.toLocaleString()} 字节
                {artifact.verifiedAt
                  ? `，校验于 ${new Date(artifact.verifiedAt).toLocaleString("zh-CN")}`
                  : ""}
              </p>
            </details>
          </div>
        </footer>
      </div>
      {source && (
        <Modal
          title={source.name}
          onClose={() => setSource(null)}
          className="reader-modal"
        >
          <div className="reader-scroll">
            <p className="section-intro">
              这份原文随当前事情保存。关闭后继续阅读报告。
            </p>
            <RichText text={source.text} reading />
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function Preferences({
  data,
  onRefresh,
  onClose,
}: {
  data: Bootstrap;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"connections" | "memory" | "about">(
    "connections",
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [type, setType] = useState<"a2a" | "mcp">("a2a");
  const [memory, setMemory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mutate = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await onRefresh();
      setAdding(false);
      setMemory("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="连接与偏好" onClose={onClose} className="preferences-modal">
      <div className="preference-tabs" role="tablist" aria-label="设置分类">
        {(
          [
            ["connections", "连接"],
            ["memory", "记忆"],
            ["about", "运行说明"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            data-testid={`personal-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="preferences-content">
        {tab === "connections" && (
          <>
            <p className="section-intro">
              先用本机助手开始。需要其他能力时，再连接你自己的服务。
            </p>
            <div className="connection-row">
              <div className="connection-symbol">
                <MessageCircle size={20} />
              </div>
              <div>
                <strong>本机助手</strong>
                <p>
                  {data.settings.codexAvailable
                    ? "Codex CLI 已找到，使用本机已有配置"
                    : "未找到 Codex CLI。安装并登录后可重试。"}
                </p>
              </div>
              <span
                className={`small-label${data.settings.codexAvailable ? " connected" : ""}`}
              >
                {data.settings.codexAvailable ? "可用" : "未连接"}
              </span>
            </div>
            <div className="connection-row">
              <div className="connection-symbol">
                <FileText size={20} />
              </div>
              <div>
                <strong>本地资料整理</strong>
                <p>文本统计与原文整理，在本机完成，不调用模型</p>
              </div>
              <span className="small-label connected">可用</span>
            </div>
            {data.connections.map((connection) => (
              <div className="connection-row" key={connection.id}>
                <div className="connection-symbol">
                  <Unplug size={20} />
                </div>
                <div>
                  <strong>{connection.name}</strong>
                  <p>
                    {connection.type.toUpperCase()} · {connection.url}
                  </p>
                  <p>
                    {connection.error ||
                      "使用对方服务的账号与权限。授权范围由对方执行。"}
                  </p>
                  {connection.auth?.configured && (
                    <p>凭据已在本机保存；账号身份由服务端验证。</p>
                  )}
                </div>
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label={`移除 ${connection.name}`}
                  onClick={() =>
                    void mutate(() =>
                      api(`/connections/${connection.id}`, undefined, "DELETE"),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {!adding ? (
              <button
                className="text-button add-connection"
                data-testid="personal-add-connection"
                onClick={() => {
                  setToken("");
                  setAdding(true);
                }}
              >
                <Plus size={16} />
                连接一个服务
              </button>
            ) : (
              <form
                className="connection-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate(async () => {
                    await api("/connections", {
                      name,
                      type,
                      url,
                      ...(token ? { token } : {}),
                    });
                    setName("");
                    setUrl("");
                    setToken("");
                  });
                }}
              >
                <label>
                  名称
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：我的研究助手"
                    data-testid="personal-connection-name"
                  />
                </label>
                <label>
                  连接方式
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as "a2a" | "mcp")}
                    data-testid="personal-connection-type"
                  >
                    <option value="a2a">远端 Agent（A2A）</option>
                    <option value="mcp">工具服务（MCP）</option>
                  </select>
                </label>
                <label>
                  服务地址
                  <input
                    required
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…"
                    data-testid="personal-connection-url"
                  />
                </label>
                <details className="credential-details">
                  <summary data-testid="personal-connection-auth-toggle">
                    连接需要访问凭据？
                  </summary>
                  <label>
                    访问令牌（可选）
                    <input
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      maxLength={8000}
                      data-testid="personal-connection-token"
                    />
                  </label>
                  <p className="field-help">
                    只用于本机服务向这个地址认证，不交给模型，也不会放进聊天或执行预览。
                  </p>
                </details>
                <p className="field-help">
                  只连接你有权使用的服务。连接不会自动分享历史对话；派工前会展示本次发送的资料。
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setToken("");
                      setAdding(false);
                    }}
                  >
                    取消
                  </button>
                  <button
                    disabled={busy}
                    className="primary-button"
                    data-testid="personal-connection-save"
                  >
                    {busy ? "正在添加…" : "添加连接地址"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        {tab === "memory" && (
          <>
            <p className="section-intro">
              只记住你明确保存的内容。这里的偏好会用于之后的执行，随时可以修正。
            </p>
            {data.memories.length === 0 && (
              <p className="quiet-empty">
                还没有长期记忆。比如，你可以记住“报告先给结论，并保留来源”。
              </p>
            )}
            {data.memories.map((item) => (
              <div key={item.id} className="memory-row">
                <p>{item.text}</p>
                <button
                  className="icon-button"
                  aria-label="移除这条记忆"
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      api(`/memories/${item.id}`, undefined, "DELETE"),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(() =>
                  api("/memories", { text: memory, clientId: key() }),
                );
              }}
            >
              <label className="sr-only" htmlFor="memory-input">
                要记住的偏好
              </label>
              <textarea
                id="memory-input"
                data-testid="personal-memory-input"
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                placeholder="有件事，希望你以后记住…"
                rows={3}
                required
                maxLength={4000}
              />
              <div className="form-actions">
                <button
                  className="primary-button"
                  data-testid="personal-memory-save"
                  disabled={busy || !memory.trim()}
                >
                  记住这件事
                </button>
              </div>
            </form>
          </>
        )}
        {tab === "about" && (
          <div className="about-copy">
            <h3>对话可以关闭，事情会留下。</h3>
            <p>
              浏览器关闭后，正在运行的本地服务会继续工作。电脑休眠、离线或服务停止期间，不能保证执行继续；回来后会读取真实状态。
            </p>
            <h3>账号与资料</h3>
            <p>
              数据保存在这台电脑的本地工作区。本机助手沿用已有 Codex
              配置，向相应模型提供本次事情的上下文。远端服务使用它自己的账号、工具和权限。
            </p>
            <p>
              每次执行只携带这件事的对话、所附文本和明确保存的记忆。当前版本面向本机单人使用，请勿把服务公开到网络。
            </p>
            <h3>决定不等于完成</h3>
            <p>
              你的选择、选择是否送达、动作是否执行和结果是否核验会分别记录。外部写入失联时先核查，不直接重复提交。
            </p>
            <h3>结果可以带走</h3>
            <p>
              报告保存为原始
              Markdown，并附文件指纹。校验通过说明文件字节一致，不代表内容已经由你接受。
            </p>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function DecisionView({
  decision,
  onDecide,
  busy,
}: {
  decision: Decision;
  onDecide: (choice: string) => void;
  busy: boolean;
}) {
  const pending = decision.state === "pending";
  const preview =
    typeof decision.preview === "string"
      ? decision.preview
      : JSON.stringify(decision.preview, null, 2);
  let readable: {
    endpoint?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
    content?: { request?: string; sources?: { name: string }[] };
  } | null = null;
  try {
    readable = JSON.parse(preview);
  } catch {
    /* Protocol-specific previews remain available below. */
  }
  const labels: Record<string, string> = {
    repoName: "仓库",
    question: "问题",
    path: "文件路径",
    url: "网址",
    content: "内容",
    text: "内容",
    title: "标题",
    to: "接收人",
    key: "记录",
    value: "值",
  };
  const receipt: Record<string, string> = {
    not_sent: "未发送",
    sending: "发送中",
    queued: "等待送达",
    delivered: "已送达",
    not_started: "尚未开始",
    running: "进行中",
    completed: "已返回结果",
    failed: "未成功",
    unknown: "待核查",
    verified: "已记录核验范围",
    not_provided: "未提供独立核验",
    cancelled: "已停止本机等待",
  };
  return (
    <section
      className={`decision${pending ? " decision-pending" : ""}`}
      data-testid="personal-decision"
    >
      <div className="decision-heading">
        <span className="decision-dot" />
        <strong>{pending ? "这里需要你决定" : "已记录你的选择"}</strong>
      </div>
      <h3>{decision.title}</h3>
      <p>{decision.summary}</p>
      {readable && (
        <dl className="decision-scope">
          {decision.identity && (
            <div>
              <dt>使用身份</dt>
              <dd>
                {decision.identity.label}，
                {decision.identity.authentication === "bearer"
                  ? "使用该连接保存的凭据，由服务端验证账号"
                  : "公开访问，不使用账号凭据"}
              </dd>
            </div>
          )}
          {readable.endpoint && (
            <div>
              <dt>发送到</dt>
              <dd>{readable.endpoint}</dd>
            </div>
          )}
          {Object.entries(readable.params?.arguments ?? {}).map(
            ([name, value]) => (
              <div key={name}>
                <dt>{labels[name] ?? name}</dt>
                <dd>
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </dd>
              </div>
            ),
          )}
          {readable.content?.request && (
            <div>
              <dt>这次要求</dt>
              <dd>{readable.content.request}</dd>
            </div>
          )}
          {readable.content?.sources && readable.content.sources.length > 0 && (
            <div>
              <dt>所附资料</dt>
              <dd>
                {readable.content.sources
                  .map((source) => source.name)
                  .join("、")}
              </dd>
            </div>
          )}
        </dl>
      )}
      <details>
        <summary>查看完整发送内容与技术信息</summary>
        <pre className="decision-preview" tabIndex={0}>
          {preview}
        </pre>
      </details>
      {pending ? (
        <div className="decision-actions">
          {decision.choices.map((choice) => (
            <button
              key={choice.key}
              className={
                choice.key === "approve" ? "primary-button" : "secondary-button"
              }
              disabled={busy}
              data-testid={`personal-decision-${choice.key}`}
              onClick={() => onDecide(choice.key)}
            >
              {busy ? "正在记录…" : choice.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="decision-receipt">
          <span>
            选择：
            {decision.decision?.choice === "approve"
              ? "同意"
              : decision.state === "cancelled"
                ? "预览已失效"
                : "未同意"}
          </span>
          <span>
            送达：
            {receipt[decision.deliveryState ?? "not_sent"] ??
              decision.deliveryState}
          </span>
          <span>
            执行：
            {receipt[decision.actionState ?? "not_started"] ??
              decision.actionState}
          </span>
          <span>
            核验：
            {receipt[decision.verificationState ?? "not_provided"] ??
              decision.verificationState}
          </span>
        </div>
      )}
    </section>
  );
}

function Composer({
  draft,
  setDraft,
  onSend,
  busy,
  connections,
  welcome = false,
}: {
  draft: Draft;
  setDraft: (value: Draft | ((current: Draft) => Draft)) => void;
  onSend: (value?: Draft) => void;
  busy: boolean;
  connections: Connection[];
  welcome?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState("");
  const [options, setOptions] = useState(false);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(input.current.scrollHeight, 200)}px`;
    }
  }, [draft.text]);
  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setFileError("");
    try {
      const added: Attachment[] = [];
      for (const file of Array.from(list)) {
        if (file.size > 500_000)
          throw new Error(`${file.name} 超过 500 KB，请先选取需要的部分。`);
        if (
          !/\.(md|markdown|txt|csv|json|log|js|ts|tsx|jsx|py|html|css|xml|yaml|yml)$/i.test(
            file.name,
          )
        )
          throw new Error(
            "目前支持文本、Markdown、CSV、JSON 和代码文件。请保留原文件，另选文本内容。",
          );
        const text = await file.text();
        if (!text.trim())
          throw new Error(
            `${file.name} 没有可读取的文字，请选择包含内容的资料。`,
          );
        if (text.includes("\u0000"))
          throw new Error(`${file.name} 不是可读取的文本文件。`);
        added.push({ name: file.name, text, size: file.size });
      }
      setDraft((current) => {
        const attachments = [...current.attachments, ...added];
        if (
          attachments.length > 5 ||
          new TextEncoder().encode(JSON.stringify(attachments)).length >
            1024 * 1024
        )
          throw new Error(
            "一次最多附 5 份资料、共 1 MB。请只保留这件事需要的内容。",
          );
        return { ...current, attachments };
      });
    } catch (error) {
      setFileError(errorText(error));
    }
    if (files.current) files.current.value = "";
  };
  return (
    <div className={`composer-wrap${welcome ? " welcome-composer" : ""}`}>
      <form
        className="composer"
        data-testid="personal-composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void addFiles(event.dataTransfer.files);
        }}
      >
        {draft.attachments.length > 0 && (
          <div className="attachment-list">
            {draft.attachments.map((file, index) => (
              <span className="attachment-chip" key={`${file.name}-${index}`}>
                <FileText size={14} />
                {file.name}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除 ${file.name}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      attachments: draft.attachments.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <label className="sr-only" htmlFor="composer-input">
          告诉我想做的事
        </label>
        <textarea
          id="composer-input"
          ref={input}
          data-testid="personal-composer-input"
          rows={welcome ? 2 : 1}
          value={draft.text}
          maxLength={24000}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          placeholder={
            welcome
              ? "想做什么？也可以附上资料，接着聊。"
              : "补充想法，或告诉我下一步…"
          }
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              if (!busy && draft.text.trim()) onSend();
            }
          }}
        />
        <div className="composer-bottom">
          <div className="composer-tools">
            <input
              ref={files}
              type="file"
              multiple
              hidden
              data-testid="personal-attachment-input"
              accept=".md,.markdown,.txt,.csv,.json,.log,.js,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yaml,.yml"
              onChange={(e) => void addFiles(e.target.files)}
            />
            <button
              className="icon-button"
              type="button"
              aria-label="附上文本资料"
              title="附上文本资料"
              onClick={() => files.current?.click()}
            >
              <Paperclip size={18} />
            </button>
            <button
              type="button"
              className="mode-button"
              onClick={() => setOptions(!options)}
              aria-expanded={options}
              data-testid="personal-mode-menu"
            >
              {draft.mode === "local"
                ? "本地整理"
                : draft.mode === "connection"
                  ? (connections.find((c) => c.id === draft.connectionId)
                      ?.name ?? "已连接服务")
                  : "自动安排"}
              <ChevronDown size={12} />
            </button>
          </div>
          <button
            type="submit"
            className="send-button"
            disabled={busy || !draft.text.trim()}
            data-testid="personal-composer-send"
            aria-label="交给助手"
          >
            {busy ? (
              <Loader2 size={18} className="working" />
            ) : (
              <ArrowUp size={19} />
            )}
          </button>
        </div>
        {options && (
          <div className="mode-options">
            <button
              type="button"
              data-testid="personal-mode-codex"
              onClick={() => {
                setDraft({ ...draft, mode: "codex", connectionId: "" });
                setOptions(false);
              }}
            >
              <MessageCircle size={16} />
              <span>
                自动安排<small>使用这台电脑的助手推进</small>
              </span>
              {draft.mode === "codex" && <Check size={16} />}
            </button>
            <button
              type="button"
              data-testid="personal-mode-local"
              onClick={() => {
                setDraft({ ...draft, mode: "local", connectionId: "" });
                setOptions(false);
              }}
            >
              <FileText size={16} />
              <span>
                本地整理<small>统计与保存资料，不调用模型</small>
              </span>
              {draft.mode === "local" && <Check size={16} />}
            </button>
            {connections.map((connection) => (
              <button
                key={connection.id}
                data-testid={`personal-mode-connection-${connection.id}`}
                type="button"
                onClick={() => {
                  setDraft({
                    ...draft,
                    mode: "connection",
                    connectionId: connection.id,
                  });
                  setOptions(false);
                }}
              >
                <Unplug size={16} />
                <span>
                  {connection.name}
                  <small>发送前先确认资料范围</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </form>
      {fileError && (
        <p className="error-text" role="alert">
          {fileError}
        </p>
      )}
      <div className="composer-caption">
        <span>
          {draft.mode === "local"
            ? "资料仅在本机整理"
            : "本次提供：当前对话、资料与已保存偏好"}
        </span>
        <span className="keyboard-hint">Enter 发送，Shift Enter 换行</span>
      </div>
    </div>
  );
}

export function App() {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const [data, setData] = useState<Bootstrap | null>(
    storage.get("bootstrap", null),
  );
  const [selected, setSelected] = useState<string | null>(initialId);
  const selectedRef = useRef(selected);
  const viewEpoch = useRef(0);
  selectedRef.current = selected;
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, rawSetDraft] = useState<Draft>(() =>
    storage.get(`draft.${initialId() ?? "new"}`, emptyDraft()),
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [preferences, setPreferences] = useState(false);
  const [reading, setReading] = useState<Artifact | null>(null);
  const [sourcePreview, setSourcePreview] = useState<Attachment | null>(null);
  const [details, setDetails] = useState(false);
  const [messageLimit, setMessageLimit] = useState(60);
  const [newContent, setNewContent] = useState(false);
  const timeline = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const previousThread = useRef<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const fetchSequence = useRef(0);
  const refresh = useCallback(async () => {
    const result = await api<Bootstrap>("/bootstrap");
    setData(result);
    storage.set("bootstrap", result);
  }, []);
  const loadThread = useCallback(async (id: string) => {
    const sequence = ++fetchSequence.current;
    const result = await api<Thread>(`/threads/${id}`);
    if (selectedRef.current === id && sequence === fetchSequence.current) {
      setThread(result);
      storage.set(`thread.${id}`, result);
    }
  }, []);
  const setDraft = (update: Draft | ((current: Draft) => Draft)) => {
    const value =
      typeof update === "function" ? update(draftRef.current) : update;
    draftRef.current = value;
    rawSetDraft(value);
    storage.set(`draft.${selected ?? "new"}`, value);
  };
  const open = useCallback((id: string | null) => {
    viewEpoch.current += 1;
    selectedRef.current = id;
    setSelected(id);
    if (initialId() !== id) {
      const url = new URL(location.href);
      url.hash = "";
      if (id) url.searchParams.set("thread", id);
      else url.searchParams.delete("thread");
      history.pushState(null, "", url);
    }
    setThread(id ? storage.get(`thread.${id}`, null) : null);
    rawSetDraft(storage.get(`draft.${id ?? "new"}`, emptyDraft()));
    setError("");
    setSidebar(false);
    setDetails(false);
    setReading(null);
    setSourcePreview(null);
    setMessageLimit(60);
    setNewContent(false);
    nearBottom.current = true;
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const navigate = () => {
      const id = initialId();
      if (id !== selectedRef.current) open(id);
    };
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", navigate);
    return () => {
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", navigate);
    };
  }, [open]);
  useEffect(() => {
    if (selected)
      void loadThread(selected).catch((e) => setError(errorText(e)));
  }, [selected, loadThread]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const synchronize = async () => {
      try {
        await refresh();
        if (selectedRef.current) await loadThread(selectedRef.current);
        if (live) setConnected(true);
      } catch (e) {
        if (live) setConnected(false);
      } finally {
        if (live) setLoading(false);
      }
    };
    void synchronize();
    const events = new EventSource("/api/events");
    const invalidate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void synchronize(), 120);
    };
    events.addEventListener("invalidation", invalidate);
    events.onmessage = invalidate;
    events.onopen = () => {
      if (live) {
        setConnected(true);
        void synchronize();
      }
    };
    events.onerror = () => {
      if (live) setConnected(false);
    };
    const visible = () => {
      if (!document.hidden) void synchronize();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", invalidate);
    window.addEventListener("offline", invalidate);
    return () => {
      live = false;
      clearTimeout(timer);
      events.close();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", invalidate);
      window.removeEventListener("offline", invalidate);
    };
  }, [refresh, loadThread]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebar(true);
        requestAnimationFrame(() => searchInput.current?.focus());
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        open(null);
        requestAnimationFrame(() =>
          document.getElementById("composer-input")?.focus(),
        );
      }
      if (event.key === "Escape") setSidebar(false);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open]);
  useEffect(() => {
    const area = timeline.current;
    if (!area || !thread) return;
    if (previousThread.current !== thread.id) {
      previousThread.current = thread.id;
      area.scrollTop = storage.get(`scroll.${thread.id}`, area.scrollHeight);
      nearBottom.current =
        area.scrollHeight - area.scrollTop - area.clientHeight < 140;
    } else if (nearBottom.current) {
      area.scrollTop = area.scrollHeight;
    } else {
      setNewContent(true);
    }
  }, [thread]);

  const submit = async (override?: Draft) => {
    const current = override ?? draft;
    if (sending || !current.text.trim()) return;
    const signature = JSON.stringify({
      text: current.text,
      attachments: current.attachments,
      mode: current.mode,
      connectionId: current.connectionId,
    });
    const next = {
      ...current,
      signature,
      memoryIds:
        current.signature === signature &&
        current.requestId &&
        current.memoryIds
          ? current.memoryIds
          : (data?.memories.map((memory) => memory.id) ?? []),
      requestId:
        current.signature === signature && current.requestId
          ? current.requestId
          : key(),
    };
    setDraft(next);
    setSending(true);
    setError("");
    const target = selected;
    const sendingView = viewEpoch.current;
    try {
      const result = await api<Thread>(
        target ? `/threads/${target}/messages` : "/threads",
        {
          text: next.text,
          clientId: next.requestId,
          attachments: next.attachments.map(({ name, text }) => ({
            name,
            text,
          })),
          mode: next.mode,
          connectionId: next.connectionId || undefined,
          memoryIds: next.memoryIds,
        },
      );
      const saved = storage.get<Draft>(
        `draft.${target ?? "new"}`,
        emptyDraft(),
      );
      const unchanged =
        saved.text === next.text &&
        saved.mode === next.mode &&
        saved.connectionId === next.connectionId &&
        JSON.stringify(saved.attachments) === JSON.stringify(next.attachments);
      const remaining = unchanged
        ? { ...emptyDraft(), mode: next.mode, connectionId: next.connectionId }
        : {
            ...saved,
            text: saved.text === next.text ? "" : saved.text,
            attachments: saved.attachments.filter(
              (file) =>
                !next.attachments.some(
                  (sent) => sent.name === file.name && sent.text === file.text,
                ),
            ),
            requestId: undefined,
            signature: undefined,
            memoryIds: undefined,
          };
      const stillInSendingView =
        selectedRef.current === target && viewEpoch.current === sendingView;
      storage.set(
        `draft.${target ?? "new"}`,
        result.id === target || !stillInSendingView ? remaining : emptyDraft(),
      );
      if (stillInSendingView) {
        if (result.id !== target) open(result.id);
        draftRef.current = remaining;
        rawSetDraft(remaining);
        storage.set(`draft.${result.id}`, remaining);
        setThread(result);
        storage.set(`thread.${result.id}`, result);
        nearBottom.current = true;
      } else if (selectedRef.current === target) {
        draftRef.current = remaining;
        rawSetDraft(remaining);
      }
      try {
        await refresh();
        if (selectedRef.current === result.id) await loadThread(result.id);
      } catch {
        setConnected(false);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };
  const mutateThread = async (path: string, body: unknown) => {
    setMutating(true);
    setError("");
    try {
      const result = await api<Thread>(path, body);
      if (selectedRef.current === result.id) setThread(result);
      await refresh();
    } catch (e) {
      setError(errorText(e));
      if (selectedRef.current) void loadThread(selectedRef.current);
    } finally {
      setMutating(false);
    }
  };
  const sample = () =>
    void submit({
      text: "把这份合成资料整理成一份可下载的阅读记录，保留原文和文件信息。",
      attachments: [
        {
          name: "reading-notes.md",
          text: "# 20 分钟阅读安排\n\n这是用于体验的合成资料，不来自私人笔记。\n\n## 开始 · 2 分钟\n找一个安静位置，打开手边的一本书。\n\n## 阅读 · 16 分钟\n连续阅读，不设页数目标。看到想记住的句子可以停一下。\n\n## 收尾 · 2 分钟\n用一句话记下今天最想保留的想法。\n\n参考：https://ia.net/writer\n\n| 阶段 | 分钟 |\n| --- | ---: |\n| 开始 | 2 |\n| 阅读 | 16 |\n| 收尾 | 2 |\n",
        },
      ],
      mode: "local",
      connectionId: "",
    });
  const threads = data?.threads ?? [];
  const waiting = threads.filter((item) => attention(item.status));
  const listed = threads.filter(
    (item) =>
      (filter === "all" || attention(item.status)) &&
      `${item.title} ${item.summary}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const pending =
    thread?.decisions.filter((item) => item.state === "pending") ?? [];
  const latest =
    thread?.runs.find((run) =>
      ["running", "verifying", "unknown"].includes(run.status),
    ) ?? thread?.runs.at(-1);

  return (
    <div className="workspace" data-testid="personal-app">
      <a className="skip-link" data-testid="personal-skip" href="#main-content">
        跳到主要内容
      </a>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="收起事情列表"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        data-testid="personal-sidebar"
        className={`sidebar${sidebar ? " sidebar-open" : ""}`}
        aria-label="事情列表"
        inert={narrow && !sidebar}
      >
        <div className="brand">
          <span className="brand-symbol">
            <MessageCircle size={19} strokeWidth={1.8} />
          </span>
          <span>AgentStudio</span>
          <button
            className="icon-button mobile-close"
            data-testid="personal-sidebar-close"
            aria-label="收起列表"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="new-thread"
          data-testid="personal-new"
          onClick={() => open(null)}
        >
          <Plus size={17} />
          新事情<kbd>⌘ N</kbd>
        </button>
        <div className="search-field">
          <Search size={15} />
          <input
            ref={searchInput}
            data-testid="personal-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="找一件事"
            aria-label="搜索事情"
          />
          <kbd>⌘ K</kbd>
        </div>
        <div className="list-filter">
          <button
            className={filter === "all" ? "selected" : ""}
            onClick={() => setFilter("all")}
          >
            最近
          </button>
          <button
            className={filter === "attention" ? "selected" : ""}
            onClick={() => setFilter("attention")}
            data-testid="personal-attention-filter"
          >
            需要你{waiting.length > 0 && <span>{waiting.length}</span>}
          </button>
        </div>
        <nav
          className="thread-list"
          aria-label="最近的事情"
          data-testid="personal-thread-list"
        >
          {listed.map((item) => (
            <button
              key={item.id}
              className={`thread-row${selected === item.id ? " current" : ""}`}
              data-testid="personal-thread-row"
              data-thread-id={item.id}
              aria-current={selected === item.id ? "page" : undefined}
              onClick={() => open(item.id)}
            >
              <div className="thread-row-title">
                <StatusMark status={item.status} label={false} />
                <span>{item.title}</span>
              </div>
              <p>
                {attention(item.status)
                  ? statusText[item.status]
                  : item.summary || statusText[item.status]}
              </p>
            </button>
          ))}
          {listed.length === 0 && (
            <p className="sidebar-empty">
              {search
                ? "还没找到，换个词试试。"
                : filter === "attention"
                  ? "现在没有需要你处理的事。"
                  : "说一件想做的事，之后都能在这里找到。"}
            </p>
          )}
        </nav>
        <footer className="sidebar-footer">
          <button
            className="settings-button"
            data-testid="personal-settings"
            onClick={() => setPreferences(true)}
          >
            <Settings2 size={16} />
            连接与偏好
          </button>
          <div className="runtime-note">
            <span className={`connection-dot${connected ? " online" : ""}`} />
            {connected
              ? "工作间在本机运行"
              : loading
                ? "正在连接本机…"
                : "本机服务未连接"}
          </div>
        </footer>
      </aside>
      <main
        id="main-content"
        className="main"
        tabIndex={-1}
        inert={narrow && sidebar}
      >
        <div className="sr-only" role="status" aria-live="polite">
          {thread?.summary}
        </div>
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="icon-button menu-toggle"
              data-testid="personal-menu"
              aria-label="打开事情列表"
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </button>
            <span>{selected ? "事情" : "你的工作间"}</span>
            {thread && (
              <>
                <ChevronRight size={14} />
                <span className="topbar-title">{thread.title}</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {thread && (
              <>
                <StatusMark status={thread.status} />
                <button
                  className="text-button results-button"
                  disabled={thread.artifacts.length === 0}
                  onClick={() => {
                    if (thread.artifacts[0])
                      setReading(thread.artifacts.at(-1)!);
                  }}
                  data-testid="personal-open-result"
                >
                  <FolderOpen size={16} />
                  <span>
                    成果
                    {thread.artifacts.length > 0
                      ? ` ${thread.artifacts.length}`
                      : ""}
                  </span>
                </button>
                <button
                  className="icon-button"
                  aria-label="查看执行记录"
                  aria-expanded={details}
                  onClick={() => setDetails(!details)}
                  data-testid="personal-details"
                >
                  <History size={18} />
                </button>
              </>
            )}
          </div>
        </header>
        {!connected && !loading && (
          <div className="connection-banner" role="status">
            <WifiOff size={15} />
            <span>
              暂时连不上本机服务。已保存的内容和草稿仍在，恢复连接后会核对实际进展。
            </span>
            <button
              className="text-button"
              onClick={() =>
                void refresh()
                  .then(() => {
                    setConnected(true);
                    setError("");
                  })
                  .catch((e) => setError(errorText(e)))
              }
            >
              重新连接
            </button>
          </div>
        )}
        {selected ? (
          thread ? (
            <>
              <div
                className="timeline"
                ref={timeline}
                data-testid="personal-timeline"
                onScroll={(event) => {
                  const area = event.currentTarget;
                  nearBottom.current =
                    area.scrollHeight - area.scrollTop - area.clientHeight <
                    140;
                  if (nearBottom.current) setNewContent(false);
                  storage.set(`scroll.${thread.id}`, area.scrollTop);
                }}
              >
                <div className="conversation">
                  <div className="thread-intro">
                    <p>
                      {new Date(thread.createdAt).toLocaleDateString("zh-CN", {
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                    <h1>{thread.title}</h1>
                  </div>
                  {pending.length > 0 && (
                    <a className="pending-anchor" href="#current-decision">
                      <span className="decision-dot" />有 {pending.length}{" "}
                      件事等你决定
                      <ArrowDown size={14} />
                    </a>
                  )}
                  {thread.messages.length > messageLimit && (
                    <button
                      className="text-button older-messages"
                      onClick={() => {
                        const before = timeline.current?.scrollHeight ?? 0;
                        setMessageLimit(messageLimit + 60);
                        requestAnimationFrame(() => {
                          if (timeline.current)
                            timeline.current.scrollTop +=
                              timeline.current.scrollHeight - before;
                        });
                      }}
                    >
                      查看更早的{" "}
                      {Math.min(60, thread.messages.length - messageLimit)}{" "}
                      条消息
                    </button>
                  )}
                  {thread.messages.slice(-messageLimit).map((message) => (
                    <article
                      key={message.id}
                      className={`message message-${message.role}`}
                      data-testid="personal-message"
                    >
                      <div className="message-author">
                        {message.role === "user" ? (
                          "你"
                        ) : message.role === "assistant" ? (
                          <>
                            <span className="assistant-mark">
                              <MessageCircle size={12} />
                            </span>
                            助手
                          </>
                        ) : (
                          "运行记录"
                        )}
                        <time dateTime={message.createdAt}>
                          {date(message.createdAt)}
                        </time>
                      </div>
                      <div className="message-content">
                        <RichText
                          onSource={(id) => {
                            const found = thread.messages
                              .flatMap((item) => item.attachments ?? [])
                              .find((item) => item.id === id);
                            if (found) setSourcePreview(found);
                            else
                              setError(
                                "这处引用没有对应的已保存资料，可在执行记录中核对来源。",
                              );
                          }}
                          text={
                            message.artifactId && message.text.length > 1000
                              ? `${message.text.slice(0, 360)}\n\n…`
                              : message.text
                          }
                        />
                        {message.artifactId && message.text.length > 1000 && (
                          <button
                            className="text-button read-full"
                            onClick={() => {
                              const artifact = thread.artifacts.find(
                                (item) => item.id === message.artifactId,
                              );
                              if (artifact) setReading(artifact);
                            }}
                          >
                            <BookOpen size={15} />
                            打开完整报告
                          </button>
                        )}
                        {message.attachments?.map((file, i) => (
                          <details
                            className="attached-source"
                            key={file.id ?? i}
                          >
                            <summary>
                              <FileText size={15} />
                              {file.name}
                              <span>查看所附原文</span>
                            </summary>
                            <pre tabIndex={0}>{file.text}</pre>
                          </details>
                        ))}
                      </div>
                    </article>
                  ))}
                  {thread.status !== "completed" &&
                    thread.status !== "cancelled" && (
                      <div
                        className={`current-state${attention(thread.status) ? " current-state-attention" : ""}`}
                        role="status"
                        data-testid="personal-current-state"
                      >
                        <StatusMark status={thread.status} />
                        <p>{thread.summary}</p>
                        {active(thread.status) && (
                          <button
                            className="text-button"
                            disabled={mutating}
                            onClick={() =>
                              void mutateThread(
                                `/threads/${thread.id}/cancel`,
                                {
                                  clientId: `cancel-${thread.id}-${latest?.id}`,
                                  runId: latest?.id,
                                },
                              )
                            }
                          >
                            <Square size={12} />
                            停止这次执行
                          </button>
                        )}
                        {["blocked", "failed", "unknown"].includes(
                          thread.status,
                        ) && (
                          <button
                            className="secondary-button"
                            data-testid="personal-retry"
                            disabled={mutating}
                            onClick={() =>
                              void mutateThread(
                                `/threads/${thread.id}/${thread.status === "unknown" ? "reconcile" : "retry"}`,
                                {
                                  clientId: `retry-${thread.id}-${latest?.id}`,
                                  runId: latest?.id,
                                },
                              )
                            }
                          >
                            {thread.status === "unknown"
                              ? "先核查结果"
                              : "重新尝试"}
                          </button>
                        )}
                      </div>
                    )}
                  {thread.decisions.length > 0 && (
                    <div id="current-decision">
                      {thread.decisions
                        .filter((item) => item.state === "pending")
                        .map((decision) => (
                          <DecisionView
                            key={decision.id}
                            decision={decision}
                            busy={mutating}
                            onDecide={(choice) =>
                              void mutateThread(`/decisions/${decision.id}`, {
                                choice,
                                version: decision.version,
                                clientId: `decision-${decision.id}-${decision.version}-${choice}`,
                              })
                            }
                          />
                        ))}
                      {thread.decisions.some(
                        (item) => item.state !== "pending",
                      ) && (
                        <details
                          className="past-decisions"
                          data-testid="personal-past-decisions"
                        >
                          <summary>
                            已处理的决定{" "}
                            {
                              thread.decisions.filter(
                                (item) => item.state !== "pending",
                              ).length
                            }
                          </summary>
                          {thread.decisions
                            .filter((item) => item.state !== "pending")
                            .map((decision) => (
                              <DecisionView
                                key={decision.id}
                                decision={decision}
                                busy={mutating}
                                onDecide={() => undefined}
                              />
                            ))}
                        </details>
                      )}
                    </div>
                  )}
                  {thread.artifacts.length > 0 && (
                    <div className="artifact-list" aria-label="这件事的成果">
                      {thread.artifacts.map((artifact, index) => (
                        <button
                          className="artifact"
                          key={artifact.id}
                          onClick={() => setReading(artifact)}
                          data-testid="personal-artifact"
                        >
                          <span className="artifact-symbol">
                            <FileText size={23} />
                          </span>
                          <span>
                            <strong>{artifact.title}</strong>
                            <small>
                              {artifact.verifiedAt ? (
                                <>
                                  <ShieldCheck size={12} />
                                  已保存并校验
                                </>
                              ) : (
                                "已保存"
                              )}
                              <span>
                                第 {index + 1} 份 · {date(artifact.createdAt)}
                              </span>
                            </small>
                          </span>
                          <BookOpen size={17} />
                        </button>
                      ))}
                    </div>
                  )}
                  {details && (
                    <section
                      className="execution-details"
                      data-testid="personal-execution-details"
                    >
                      <div className="detail-title">
                        <h2>执行记录</h2>
                        <button
                          className="icon-button"
                          aria-label="收起执行记录"
                          onClick={() => setDetails(false)}
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <p className="muted">
                        这件事的消息、所附资料和已保存偏好，会作为本次上下文。连接服务时会另行确认。
                      </p>
                      {thread.runs.map((run) => (
                        <div className="run-row" key={run.id}>
                          <StatusMark status={run.status} />
                          <span>
                            {run.mode === "local"
                              ? "本地资料整理"
                              : run.mode === "connection"
                                ? (data?.connections.find(
                                    (c) => c.id === run.connectionId,
                                  )?.name ?? "已连接服务")
                                : "本机助手"}
                          </span>
                          {run.externalTaskId && (
                            <code>{run.externalTaskId}</code>
                          )}
                          {run.routingReason && (
                            <p className="routing-reason">
                              安排原因：{run.routingReason}
                            </p>
                          )}
                          {run.remoteReceipt !== undefined && (
                            <details className="raw-receipt">
                              <summary>查看原始执行回执</summary>
                              <pre tabIndex={0}>
                                {JSON.stringify(run.remoteReceipt, null, 2)}
                              </pre>
                            </details>
                          )}
                          {run.externalVerification !== undefined && (
                            <details className="raw-receipt">
                              <summary>查看核验范围</summary>
                              <pre tabIndex={0}>
                                {JSON.stringify(
                                  run.externalVerification,
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          )}
                          {run.error && (
                            <p className="error-text">{run.error}</p>
                          )}
                        </div>
                      ))}
                      <ol className="event-list">
                        {thread.events.map((event) => (
                          <li key={event.id}>
                            <time>{date(event.createdAt)}</time>
                            <span>{event.text}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                </div>
              </div>
              {newContent && (
                <button
                  className="new-content"
                  onClick={() => {
                    if (timeline.current)
                      timeline.current.scrollTop =
                        timeline.current.scrollHeight;
                    nearBottom.current = true;
                    setNewContent(false);
                  }}
                >
                  <ArrowDown size={15} />
                  回到最新进展
                </button>
              )}
              <div className="conversation-footer">
                {error && (
                  <p className="error-text action-error" role="alert">
                    {error}
                  </p>
                )}
                <Composer
                  draft={draft}
                  setDraft={setDraft}
                  onSend={(value) => void submit(value)}
                  busy={sending}
                  connections={data?.connections ?? []}
                />
              </div>
            </>
          ) : (
            <div className="loading-thread">
              <Loader2 size={22} className="working" />
              <p>{error || "正在找回这件事…"}</p>
              {error && (
                <button
                  className="text-button"
                  onClick={() =>
                    selected &&
                    void loadThread(selected).catch((e) =>
                      setError(errorText(e)),
                    )
                  }
                >
                  再试一次
                </button>
              )}
            </div>
          )
        ) : (
          <div className="welcome">
            <div className="welcome-content">
              <div className="welcome-glyph">
                <MessageCircle size={25} strokeWidth={1.6} />
                <span />
              </div>
              <p className="welcome-salutation">留一点心力，给真正重要的事。</p>
              <h1>有件事，交给我。</h1>
              <p className="welcome-copy">
                从一句话开始。进展、需要你决定的事和最后的成果，都留在这里。
              </p>
              <Composer
                welcome
                draft={draft}
                setDraft={setDraft}
                onSend={(value) => void submit(value)}
                busy={sending}
                connections={data?.connections ?? []}
              />
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              <div className="starting-points">
                <button
                  onClick={() => {
                    setDraft({
                      ...draft,
                      text: "帮我整理这些资料，先给结论，保留来源。",
                    });
                    document.getElementById("composer-input")?.focus();
                  }}
                >
                  <Paperclip size={16} />
                  <span>整理一份资料</span>
                </button>
                <button
                  onClick={() => {
                    setDraft({
                      ...draft,
                      text: "我有一个想法，想和你一起把它变成可执行的计划：",
                    });
                    document.getElementById("composer-input")?.focus();
                  }}
                >
                  <MessageCircle size={16} />
                  <span>一起想清楚</span>
                </button>
                <button
                  disabled={sending}
                  data-testid="personal-sample"
                  onClick={sample}
                >
                  <BookOpen size={16} />
                  <span>先体验一件小事</span>
                  <ChevronRight size={13} />
                </button>
              </div>
              <p className="sample-note">
                体验使用合成阅读资料，由本地整理生成真实文件。
              </p>
              {waiting.length > 0 && (
                <section className="return-overview">
                  <h2>回来后，从这里继续</h2>
                  {waiting.slice(0, 3).map((item) => (
                    <button key={item.id} onClick={() => open(item.id)}>
                      <StatusMark status={item.status} />
                      <span>{item.title}</span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </section>
              )}
            </div>
            <p className="welcome-footnote">
              <ShieldCheck size={13} />
              本机保存 · 决定有记录 · 成果可带走
            </p>
          </div>
        )}
      </main>
      {preferences && data && (
        <Preferences
          data={data}
          onRefresh={refresh}
          onClose={() => setPreferences(false)}
        />
      )}
      {reading && (
        <Reader
          artifact={reading}
          sources={
            thread?.messages.flatMap((item) => item.attachments ?? []) ?? []
          }
          onClose={() => setReading(null)}
        />
      )}
      {sourcePreview && (
        <Modal
          title={sourcePreview.name}
          onClose={() => setSourcePreview(null)}
          className="reader-modal"
        >
          <div className="reader-scroll">
            <p className="section-intro">这是当前事情保存的原始资料。</p>
            <RichText text={sourcePreview.text} reading />
          </div>
        </Modal>
      )}
      {preferences && !data && (
        <Modal title="连接与偏好" onClose={() => setPreferences(false)}>
          <div className="preferences-content">
            <p>先启动本机服务，才能读取连接与偏好。</p>
            <p className="error-text">{error}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
