import type { PersonalDesktopBridge } from "./desktop-contract";

declare global {
  interface Window {
    agentStudioPersonal?: PersonalDesktopBridge;
  }
}

export const desktopBridge = () => window.agentStudioPersonal;
