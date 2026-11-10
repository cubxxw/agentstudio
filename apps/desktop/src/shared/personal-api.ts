import type { PersonalDesktopBridge, DesktopCommand } from "@agentstudio/personal/desktop-contract";
export type { PersonalDesktopBridge as AgentStudioPersonal, DesktopMethod } from "@agentstudio/personal/desktop-contract";
export type PersonalCommand = DesktopCommand;
export type PersonalRequest = Parameters<PersonalDesktopBridge["request"]>[0];
export type PersonalResponse = Awaited<ReturnType<PersonalDesktopBridge["request"]>>;
export type PersonalChange = { threadId?: string };
export type PersonalSaveResult = Awaited<ReturnType<PersonalDesktopBridge["saveArtifact"]>>;

export const PERSONAL_IPC = {
  info: "agentstudio:personal:info",
  request: "agentstudio:personal:request",
  changed: "agentstudio:personal:changed",
  command: "agentstudio:personal:command",
  saveArtifact: "agentstudio:personal:save-artifact",
  restart: "agentstudio:personal:restart",
} as const;

const opaqueId = "[A-Za-z0-9_-]{1,160}";
const routes: Record<PersonalRequest["method"], RegExp[]> = {
  GET: [
    /^\/api\/(health|bootstrap|connections|memories)$/,
    new RegExp(`^/api/(threads|artifacts)/${opaqueId}$`),
    new RegExp(`^/api/connections/${opaqueId}/tools$`),
  ],
  POST: [
    /^\/api\/(threads|connections|memories)$/,
    new RegExp(`^/api/threads/${opaqueId}/(messages|retry|reconcile|cancel)$`),
    new RegExp(`^/api/decisions/${opaqueId}$`),
  ],
  DELETE: [new RegExp(`^/api/(connections|memories)/${opaqueId}$`)],
};

/** Fixed local API capabilities; never URLs, arbitrary headers, streams or files. */
export function readPersonalRequest(value: unknown): PersonalRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid personal request");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["path", "method", "body"].includes(key))) throw new Error("Unsupported personal request field");
  if (typeof input.path !== "string" || typeof input.method !== "string" || !Object.hasOwn(routes, input.method)) throw new Error("Invalid personal route");
  const method = input.method as PersonalRequest["method"];
  if (!routes[method].some((route) => route.test(input.path as string))) throw new Error("Personal route is not allowed");
  if (method === "POST") {
    if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) throw new Error("A JSON object is required");
    if (new TextEncoder().encode(JSON.stringify(input.body)).byteLength > 2_000_000) throw new Error("Personal request is too large");
  } else if (input.body !== undefined) throw new Error("This personal method does not accept a body");
  return { path: input.path, method, ...(input.body === undefined ? {} : { body: input.body }) };
}

export function isArtifactId(value: unknown): value is string {
  return typeof value === "string" && /^art_[A-Za-z0-9_-]{1,155}$/.test(value);
}

/** A pathname, origin and top-frame check belong at the main-process IPC boundary. */
export function isTrustedDocument(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual), b = new URL(expected);
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname && !a.username && !a.password;
  } catch { return false; }
}

export function personalCsp(developmentUrl?: string): string {
  const script = ["'self'"], connect = ["'none'"];
  if (developmentUrl) {
    const dev = new URL(developmentUrl);
    script.push("'unsafe-inline'");
    connect.splice(0, 1, dev.origin, `${dev.protocol === "https:" ? "wss:" : "ws:"}//${dev.host}`);
  }
  return ["default-src 'none'", `script-src ${script.join(" ")}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", `connect-src ${connect.join(" ")}`, "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'"].join("; ");
}
