import { describe, expect, it } from "vitest";
import { isArtifactId, isTrustedDocument, personalCsp, readPersonalRequest } from "../src/shared/personal-api";

describe("personal IPC capabilities", () => {
  it("accepts the existing task, approval, memory and connection routes", () => {
    expect(readPersonalRequest({ path: "/api/bootstrap", method: "GET" })).toEqual({ path: "/api/bootstrap", method: "GET" });
    expect(readPersonalRequest({ path: "/api/threads/thr_own/messages", method: "POST", body: { text: "补充", clientId: "accepted-request-id" } }).path).toBe("/api/threads/thr_own/messages");
    expect(readPersonalRequest({ path: "/api/decisions/dec_own", method: "POST", body: { choice: "approve", version: 1, clientId: "accepted-request-id" } }).method).toBe("POST");
    expect(readPersonalRequest({ path: "/api/connections/con_own", method: "DELETE" }).method).toBe("DELETE");
  });

  it("rejects arbitrary destinations, headers, filesystem routes, streams and traversal", () => {
    for (const path of ["https://example.com/api/bootstrap", "//127.0.0.1:18740/api/bootstrap", "file:///etc/passwd", "/api/threads/../connections", "/api/threads/%2e%2e", "/api/events", "/api/artifacts/art_own/download", "/api/bootstrap?url=http://example.com", "/internal/admin"]) {
      expect(() => readPersonalRequest({ path, method: "GET" })).toThrow();
    }
    expect(() => readPersonalRequest({ path: "/api/bootstrap", method: "GET", headers: { Authorization: "not allowed" } })).toThrow();
    expect(() => readPersonalRequest({ path: "/api/bootstrap", method: "PUT" })).toThrow();
    expect(() => readPersonalRequest({ path: "/api/bootstrap", method: "GET", body: {} })).toThrow();
    expect(() => readPersonalRequest({ path: "/api/threads", method: "POST", body: [] })).toThrow();
    expect(() => readPersonalRequest({ path: "/api/threads", method: "POST", body: { text: "字".repeat(700_000) } })).toThrow();
  });

  it("only accepts opaque artifact identifiers for the native save dialog", () => {
    expect(isArtifactId("art_97bf-accepted")).toBe(true);
    for (const id of ["/etc/passwd", "art_x/../../secret", "https://example.com/", null, "thread_1"]) expect(isArtifactId(id)).toBe(false);
  });
});

describe("trusted bundled document", () => {
  const own = "file:///Applications/AgentStudio.app/Contents/Resources/app.asar/out/renderer/personal/index.html";
  it("accepts only the exact file or dev pathname, with ordinary in-document anchors", () => {
    expect(isTrustedDocument(`${own}#source-att_own`, own)).toBe(true);
    expect(isTrustedDocument("http://127.0.0.1:5173/personal/index.html#own", "http://127.0.0.1:5173/personal/index.html")).toBe(true);
    expect(isTrustedDocument("http://127.0.0.1:51730/personal/index.html", "http://127.0.0.1:5173/personal/index.html")).toBe(false);
    expect(isTrustedDocument("http://127.0.0.1:5173.evil.example/personal/index.html", "http://127.0.0.1:5173/personal/index.html")).toBe(false);
    expect(isTrustedDocument(own.replace("personal/index.html", "index.html"), own)).toBe(false);
    expect(isTrustedDocument(own.replace("file:///", "file://other-host/"), own)).toBe(false);
  });

  it("needs no renderer HTTP access and does not weaken script execution", () => {
    const csp = personalCsp();
    expect(csp).toContain("connect-src 'none'"); expect(csp).toContain("default-src 'none'"); expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("http:");
    expect(personalCsp("http://127.0.0.1:5173")).toContain("connect-src http://127.0.0.1:5173 ws://127.0.0.1:5173");
  });
});
