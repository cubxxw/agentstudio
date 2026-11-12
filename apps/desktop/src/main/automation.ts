import { isAbsolute } from 'node:path';

export function backgroundAutomation() { return process.env.AGENTROOM_AUTOMATION_MODE === 'background'; }
export function automationWindowOptions() {
  return backgroundAutomation() ? { show: false, focusable: false, skipTaskbar: true } : {};
}

/** Presentation policy for the isolated native acceptance launcher. */
export function resolveAutomation(env: NodeJS.ProcessEnv, revision: string) {
  const mode = env.AGENTROOM_AUTOMATION_MODE;
  if (!mode) return { enabled: false, visible: true, title: null };
  if (mode !== 'background' && mode !== 'visible') throw new Error('Invalid native automation mode');
  if (!env.AGENTSTUDIO_USER_DATA_DIR || !isAbsolute(env.AGENTSTUDIO_USER_DATA_DIR)) throw new Error('Native automation requires an isolated absolute profile');
  if (env.AGENTROOM_EXPECTED_BUILD_REF !== revision) throw new Error(`Native automation build mismatch: expected ${env.AGENTROOM_EXPECTED_BUILD_REF || 'missing'}, actual ${revision}`);
  return { enabled: true, visible: mode === 'visible', title: `AgentRoom · 自动化验收 · ${revision.slice(0, 8)}` };
}
