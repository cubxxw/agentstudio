import { describe, expect, it } from 'vitest';
import { resolveAutomation } from '../src/main/automation';

const revision = 'a'.repeat(40);
describe('native automation', () => {
  it('keeps ordinary launches visible and unchanged', () => {
    expect(resolveAutomation({}, revision)).toEqual({ enabled: false, visible: true, title: null });
  });
  it('requires an isolated profile and the exact compiled revision', () => {
    expect(() => resolveAutomation({ AGENTROOM_AUTOMATION_MODE: 'background' }, revision)).toThrow(/profile/);
    expect(() => resolveAutomation({ AGENTROOM_AUTOMATION_MODE: 'background', AGENTSTUDIO_USER_DATA_DIR: '/tmp/test', AGENTROOM_EXPECTED_BUILD_REF: 'b'.repeat(40) }, revision)).toThrow(/build mismatch/);
  });
  it('defaults automated windows to hidden and identifies their source', () => {
    expect(resolveAutomation({ AGENTROOM_AUTOMATION_MODE: 'background', AGENTSTUDIO_USER_DATA_DIR: '/tmp/test', AGENTROOM_EXPECTED_BUILD_REF: revision }, revision)).toEqual({ enabled: true, visible: false, title: 'AgentRoom · 自动化验收 · aaaaaaaa' });
  });
  it('only permits explicit visible automation with a matching build', () => {
    expect(resolveAutomation({ AGENTROOM_AUTOMATION_MODE: 'visible', AGENTSTUDIO_USER_DATA_DIR: '/tmp/test', AGENTROOM_EXPECTED_BUILD_REF: revision }, revision).visible).toBe(true);
    expect(() => resolveAutomation({ AGENTROOM_AUTOMATION_MODE: 'anything' }, revision)).toThrow();
  });
});
