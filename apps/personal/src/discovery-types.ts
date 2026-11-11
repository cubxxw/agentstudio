import type { LocalAgentId } from "./types";

export type DiscoveredContact = {
  contactId: string;
  name: string;
  handle: string;
  color: string;
  icon: string;
  localAgentId?: LocalAgentId;
  providerName: string;
  source: "installed_local_agent" | "existing_connection";
  capabilities: {
    chat: true;
    incrementalReply: "supported" | "unknown";
    stop: "supported" | "unknown";
    conversationIsolation: "per_thread" | "single_active_service_conversation" | "unknown";
  };
};

export type DiscoveryRecommendation =
  | { id: string; kind: "open_contact"; contactId: string; title: string; reason: string; source: "installed_local_agent" | "existing_connection" }
  | { id: string; kind: "prepare_roles"; title: string; reason: string; source: "existing_role_onboarding" }
  | { id: string; kind: "connect"; title: string; reason: string; source: "local_discovery" };

export type ConfiguredContact = DiscoveredContact & {
  source: "existing_connection";
  statusLabel: "已保存连接，发送时核对";
};

export type HostDiscoveryResult = {
  schemaVersion: 1;
  sampledAt: string;
  localAgentsCheckedAt: string | null;
  host: {
    source: "node:os" | "unavailable";
    platform: "darwin" | "linux" | "win32" | "unknown";
    architecture: "arm64" | "x64" | "ia32" | "arm" | "unknown";
    totalMemoryGiB: number | null;
    freeMemoryGiB: number | null;
    cpuCount: number | null;
    memoryPressure: "unknown";
    diskAvailableGiB: number | null;
    queueDepth: number | null;
  };
  agents: {
    id: LocalAgentId;
    name: string;
    version: string | null;
    authStatus: "configured" | "required" | "unknown" | "unsupported";
    executionSupported: boolean;
    state: "configuration_detected" | "login_required" | "unsupported" | "unknown";
    executionVerified: false;
  }[];
  readyContacts: DiscoveredContact[];
  configuredContacts: ConfiguredContact[];
  canPrepareRoles: boolean;
  recommendations: DiscoveryRecommendation[];
  excludedToolsCount: number;
};
