export type Status =
  | "queued"
  | "running"
  | "needs_input"
  | "blocked"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";
export type Mode = "codex" | "local" | "connection";
export type LocalAgentId = "codex" | "claude" | "pi" | "gemini" | "opencode";
export type AgentConfiguration = { modelMode: "follow" | "fixed"; provider?: string; model?: string; thinking: string };
export type AgentProfile = {
  agentId: LocalAgentId; defaults: { provider: string | null; model: string | null; thinking: string | null };
  models: { provider: string; id: string; name: string; reasoning: boolean; images?: boolean; thinkingLevels?: string[] }[];
  providers: string[]; thinkingLevels: string[]; modelThinkingLevels: Record<string, string>; source: string; version: string; description: string;
};
export type ExecutionSnapshot = { agentId: LocalAgentId; provider: string | null; model: string | null; thinking: string | null; configurationVersion: string; modelPolicy: string; thinkingPolicy: string };
export type LocalAgent = {
  id: LocalAgentId;
  name: string;
  installed: boolean;
  version: string | null;
  auth: { status: "configured" | "required" | "unknown" | "unsupported"; method?: string };
  execution: { supported: boolean; reason?: string };
  profile?: AgentProfile;
  setupUrl: string;
  loginCommandId: string | null;
};
export type Integrations = {
  checkedAt: string;
  agents: LocalAgent[];
  selectedLocalAgentId: LocalAgentId;
  presets: { id: string; name: string; description: string; account: string; connectionId: string | null }[];
};
export type Attachment = {
  id?: string;
  name: string;
  text: string;
  size?: number;
};
export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  attachments?: Attachment[];
  artifactId?: string;
  runId?: string;
  contactId?: string;
  contactSnapshot?: Contact;
  replyTo?: string | null;
  deliveryState?: string;
  skippedContacts?: { id: string; name: string; reason: string }[];
};
export type Run = {
  id: string;
  status: Status;
  mode: Mode;
  localAgentId?: LocalAgentId;
  connectionId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  externalTaskId?: string;
  requestedMode?: Mode;
  chosenExecutor?: string;
  routingReason?: string;
  remoteReceipt?: unknown;
  externalVerification?: unknown;
  requiresReconciliation?: boolean;
  cancelPending?: boolean;
  stopUnconfirmed?: boolean;
  contactId?: string;
  contactSnapshot?: Contact;
  messageId: string;
  progress?: { phase: "preparing" | "thinking" | "writing"; text: string; updatedAt: string };
  executionSnapshot?: ExecutionSnapshot;
};
export type Artifact = {
  id: string;
  title: string;
  mimeType: string;
  size: number;
  sha256: string;
  runId: string;
  createdAt: string;
  verifiedAt?: string;
  body?: string;
};
export type Decision = {
  identity?: {
    label: string;
    authentication: "none" | "bearer";
    identityVerified: boolean;
  };
  id: string;
  version: number;
  title: string;
  summary: string;
  preview: unknown;
  choices: { key: string; label: string }[];
  state: string;
  decision: { choice: string; decidedAt: string } | null;
  deliveryState: string | null;
  actionState: string | null;
  verificationState: string | null;
};
export type ThreadSummary = {
  id: string;
  title: string;
  status: Status;
  summary: string;
  updatedAt: string;
  kind?: "direct" | "group";
  memberIds?: string[];
  version?: number;
  lastMessage?: { text: string; contactId?: string } | null;
  pendingApprovals?: number;
};
export type Thread = ThreadSummary & {
  createdAt: string;
  messages: Message[];
  runs: Run[];
  artifacts: Artifact[];
  decisions: Decision[];
  events: { id: string; type: string; text: string; createdAt: string }[];
  responsePolicies?: Record<string, ResponsePolicy>;
};
export type Connection = {
  id: string;
  name: string;
  type: "a2a" | "mcp";
  url: string;
  status?: string;
  capabilities?: unknown;
  error?: string;
  auth?: {
    type: "none" | "bearer";
    configured: boolean;
    identityVerified: boolean;
  };
};
export type Memory = { id: string; text: string; createdAt: string };
export type ResponsePolicy = "mention" | "always" | "manual";
export type Contact = {
  id: string; kind: "agent" | "human"; name: string; handle: string;
  description: string; instructions: string; color: string; version: number;
  icon?: string; avatarAgent?: LocalAgentId; configuration?: AgentConfiguration; profile?: AgentProfile | null; execution?: ExecutionSnapshot | null; configurationError?: string;
  discovered?: boolean; providerName?: string;
  binding: { type: "local"; localAgentId: LocalAgentId } | { type: "connection"; connectionId: string } | null;
  availability: "self" | "ready" | "unsupported" | "not_installed" | "login_required" | "disconnected" | "local_only" | "configuration_required";
  availabilityReason?: string;
};
export type Approval = Decision & { threadId: string; threadTitle: string; contact: Contact | null };
export type Bootstrap = {
  threads: ThreadSummary[];
  connections: Connection[];
  memories: Memory[];
  settings: { defaultMode: Mode; codexAvailable: boolean; localAgentId?: LocalAgentId };
  runtime?: Record<string, unknown>;
};
