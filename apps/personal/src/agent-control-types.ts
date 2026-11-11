export type AgentGoal = { text: string; status: "active" | "paused" | "completed" };
export type AgentSchedule = {
  enabled: boolean;
  mode: "interval" | "daily" | "autonomous";
  intervalMinutes: number;
  time: string;
  timeZone: string;
  maxRunsPerDay: number;
};
export type AgentControl = {
  contactId: string;
  version: number;
  goal: AgentGoal;
  scheduler: AgentSchedule;
  supported: boolean;
  autonomousSupported: boolean;
  unsupportedReason: string;
  state: "idle" | "scheduled" | "queued" | "running" | "blocked" | "paused" | "completed";
  nextRunAt: string | null;
  lastRunAt?: string;
  lastReason?: string;
  runsToday: number;
  recentRuns: { runId: string; threadId: string; status: string; createdAt: string; error?: string }[];
};
