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
};
export type Run = {
  id: string;
  status: Status;
  mode: Mode;
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
};
export type Thread = ThreadSummary & {
  createdAt: string;
  messages: Message[];
  runs: Run[];
  artifacts: Artifact[];
  decisions: Decision[];
  events: { id: string; type: string; text: string; createdAt: string }[];
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
export type Bootstrap = {
  threads: ThreadSummary[];
  connections: Connection[];
  memories: Memory[];
  settings: { defaultMode: Mode; codexAvailable: boolean };
  runtime?: Record<string, unknown>;
};
