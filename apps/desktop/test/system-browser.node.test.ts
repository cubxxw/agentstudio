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
it("opens the same PKCE URL in an owned sign-in window if both OS routes fail", async () => {
 const inApp=vi.fn(async()=>{}),url="https://cursor.com/loginDeepControl?challenge=synthetic";
 await openSystemBrowser(url,{openExternal:async()=>{throw Error("handler failed");},fallback:async()=>{throw Error("launch failed");},inApp});
 expect(inApp).toHaveBeenCalledWith(url);
});
it("does not open a fallback window after the sign-in scope was cancelled", async()=>{
 const abort=new AbortController(),fallback=vi.fn(async()=>{}),inApp=vi.fn(async()=>{});
 await expect(openSystemBrowser("https://cursor.com/loginDeepControl?uuid=synthetic",{signal:abort.signal,openExternal:async()=>{abort.abort();throw Error("late failure");},fallback,inApp})).rejects.toThrow();
 expect(fallback).not.toHaveBeenCalled();expect(inApp).not.toHaveBeenCalled();
});
