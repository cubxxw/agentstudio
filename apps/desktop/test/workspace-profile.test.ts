import { describe, it, expect } from 'vitest';
import { cleanDesktopTestEnv } from '../../../dev/desktop-test-env.mjs';
import { resolveWorkspaceProfile, testWorkspaceArgs } from '../src/main/workspace-profile';
describe('workspace profiles', () => {
 it('preserves existing normal profile and explicit personal override', () => {
  const p=resolveWorkspaceProfile('/support', {AGENTSTUDIO_USER_DATA_DIR:'/custom', AGENTSTUDIO_PERSONAL_DATA_DIR:'/personal'}, []);
  expect(p).toMatchObject({testMode:false,userData:'/custom',personalData:'/personal'});
  expect(resolveWorkspaceProfile('/support',{},[]).userData).toBe('/support/AgentStudio');
 });
 it('isolates all test data and ignores a real personal override', () => {
  const p=resolveWorkspaceProfile('/support',{AGENTSTUDIO_PERSONAL_DATA_DIR:'/real'},['--agentroom-test-profile=fixture-123']);
  expect(p.testMode).toBe(true);expect(p.userData).toBe('/support/AgentStudio/agentroom-test-profiles/fixture-123');
  expect(p.personalData).toBe(p.userData+'/personal');
 });
 it('native acceptance clears inherited aliases before selecting its isolated profile', () => {
  const env=cleanDesktopTestEnv({AGENTSTUDIO_USER_DATA_DIR:'/tmp/acceptance/profile',AGENTROOM_USER_DATA_DIR:'/pretend-real-profile',AGENTROOM_PERSONAL_DATA_DIR:'/pretend-real-personal',AGENTSTUDIO_PERSONAL_DATA_DIR:'/old-real-personal',AGENTROOM_TEST_MODE:'1'});
  expect(resolveWorkspaceProfile('/support',env,[])).toMatchObject({testMode:false,userData:'/tmp/acceptance/profile',personalData:'/tmp/acceptance/profile/personal'});
 });
 it('normal mode overrides an inherited test environment', () => {
  expect(resolveWorkspaceProfile('/support',{AGENTROOM_TEST_MODE:'1'},['--agentroom-normal-mode']).testMode).toBe(false);
  expect(resolveWorkspaceProfile('/support',{AGENTROOM_TEST_MODE:'1'},[]).testMode).toBe(true);
 });
 it('rejects unsafe IDs and ambiguous flags', () => {
  expect(()=>resolveWorkspaceProfile('/support',{},['--agentroom-test-profile','other'])).toThrow();
  for(const id of ['../real','/real','','a'.repeat(81)]) expect(()=>resolveWorkspaceProfile('/support',{},['--agentroom-test-profile='+id])).toThrow();
  expect(()=>resolveWorkspaceProfile('/support',{},['--agentroom-test-profile=one','--agentroom-test-profile=two'])).toThrow();
 });
 it('replaces only mode arguments and returns to normal deterministically', () => {
  const args=['/app','--inspect=0','--agentroom-test-profile=old'];
  expect(testWorkspaceArgs(args,'reset','fresh')).toEqual(['/app','--inspect=0','--agentroom-test-profile=fresh']);
  expect(testWorkspaceArgs(args,'leave','ignored')).toEqual(['/app','--inspect=0','--agentroom-normal-mode']);
 });
});
