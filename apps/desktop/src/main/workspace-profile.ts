import { join, resolve } from "node:path";

const profilePrefix = "--agentroom-test-profile=";
const normalFlag = "--agentroom-normal-mode";
const validProfile = (value: string) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
export type TestWorkspaceAction = "enter" | "reset" | "leave";

/** Paths are chosen by main, never supplied through renderer IPC. */
export function resolveWorkspaceProfile(appData: string, env: NodeJS.ProcessEnv, args: string[]) {
  if (args.some(value => value.startsWith("--agentroom-test-profile") && !value.startsWith(profilePrefix))) throw new Error("Use --agentroom-test-profile=<id>");
  const normalData = resolve(env.AGENTROOM_USER_DATA_DIR || env.AGENTSTUDIO_USER_DATA_DIR || join(appData, "AgentStudio"));
  const flags = args.filter(value => value.startsWith(profilePrefix));
  if (flags.length > 1 || (flags.length && args.includes(normalFlag))) throw new Error("Ambiguous workspace mode");
  const profileId = flags[0]?.slice(profilePrefix.length);
  if (profileId !== undefined && !validProfile(profileId)) throw new Error("Invalid test profile ID");
  const testMode = !args.includes(normalFlag) && (profileId !== undefined || env.AGENTROOM_TEST_MODE === "1");
  const userData = testMode ? join(normalData, "agentroom-test-profiles", profileId || "default") : normalData;
  const personalData = testMode ? join(userData, "personal") : resolve(env.AGENTROOM_PERSONAL_DATA_DIR || env.AGENTSTUDIO_PERSONAL_DATA_DIR || join(userData, "personal"));
  return { testMode, userData, personalData, profileId: testMode ? profileId || "default" : null };
}

export function testWorkspaceArgs(args: string[], action: TestWorkspaceAction, profileId: string): string[] {
  if (!["enter", "reset", "leave"].includes(action)) throw new Error("Invalid test workspace action");
  if (action !== "leave" && !validProfile(profileId)) throw new Error("Invalid test profile ID");
  return [...args.filter(value => !value.startsWith(profilePrefix) && value !== normalFlag), action === "leave" ? normalFlag : `${profilePrefix}${profileId}`];
}
