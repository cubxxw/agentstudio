import { describe, expect, it, vi } from "vitest";
import { openSystemBrowser } from "../src/main/connectors/system-browser";
vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));

describe("official browser fallback", () => {
  it("uses the default browser when it opens the login", async () => {
    const fallback = vi.fn(async () => {});
    await openSystemBrowser("https://cursor.com/loginDeepControl?uuid=synthetic", { openExternal: async () => {}, fallback });
    expect(fallback).not.toHaveBeenCalled();
  });
  it("preserves the exact login URL when the system handler fails", async () => {
    const urls: string[] = [];
    await openSystemBrowser("https://cursor.com/loginDeepControl?uuid=synthetic&challenge=synthetic", {
      openExternal: async () => { throw new Error("Failed to open URL"); }, fallback: async url => { urls.push(url); },
    });
    expect(urls).toEqual(["https://cursor.com/loginDeepControl?uuid=synthetic&challenge=synthetic"]);
  });
  it("reports a failure without exposing the authentication URL", async () => {
    await expect(openSystemBrowser("https://cursor.com/loginDeepControl?uuid=synthetic", {
      openExternal: async () => { throw new Error("Failed to open URL"); }, fallback: async () => { throw new Error("private transport detail"); },
    })).rejects.toThrow("The sign-in browser could not be opened");
  });
});
