import { isAbsolute } from 'node:path';

/** Native acceptance must never inherit a user's real workspace or mode. */
export function cleanDesktopTestEnv(env) {
  if (typeof env.AGENTSTUDIO_USER_DATA_DIR !== 'string' || !isAbsolute(env.AGENTSTUDIO_USER_DATA_DIR)) throw new Error('Native acceptance requires an explicit absolute test profile');
  for (const key of ['AGENTROOM_USER_DATA_DIR', 'AGENTROOM_PERSONAL_DATA_DIR', 'AGENTSTUDIO_PERSONAL_DATA_DIR', 'AGENTROOM_TEST_MODE', 'PERSONAL_DATA_DIR', 'ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  return env;
}
