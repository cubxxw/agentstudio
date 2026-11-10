import { desktopBridge } from "./native";
import type { DesktopMethod } from "./desktop-contract";

export class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const desktop = desktopBridge();
  if (desktop) {
    const response = await desktop.request({
      path: `/api${path}`,
      method: (method ?? (body === undefined ? "GET" : "POST")) as DesktopMethod,
      ...(body === undefined ? {} : { body }),
    });
    const result = response.body as { error?: { message?: string; code?: string } } | null;
    if (response.status < 200 || response.status >= 300)
      throw new RequestError(
        result?.error?.message ?? "工作间暂时无法连接，内容已保留。",
        result?.error?.code ?? "request_failed",
        response.status,
      );
    return response.body as T;
  }
  const response = await fetch(`/api${path}`, {
    signal: AbortSignal.timeout(15000),
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw new RequestError(
      result?.error?.message ?? "暂时无法完成，请稍后再试。",
      result?.error?.code ?? "request_failed",
      response.status,
    );
  return result as T;
}

export const key = () => crypto.randomUUID();
