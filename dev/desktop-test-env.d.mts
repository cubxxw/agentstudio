export function cleanDesktopTestEnv<T extends Record<string, string | undefined>>(env: T): T;
export function desktopSource(root?: string): { revision: string; fingerprint: string; automation: number };
export function launchDesktopTest<T>(electron: { launch(options: any): Promise<T> }, options: { executablePath?: string; args?: string[]; env?: Record<string, string | undefined>; timeout?: number }, config?: { lockPath?: string; runtimePath?: string }): Promise<T>;
