// Pure types shared by the bundled renderer and its narrow Electron preload.
// Credentials, filesystem APIs and arbitrary network destinations are not exposed.
export type DesktopCommand = "new" | "search" | "settings";
export type DesktopMethod = "GET" | "POST" | "DELETE";
export interface PersonalDesktopBridge {
  readonly platform: string;
  readonly version: string;
  request(input: {
    path: string;
    method: DesktopMethod;
    body?: unknown;
  }): Promise<{ status: number; body: unknown }>;
  onChanged(listener: () => void): () => void;
  onCommand(listener: (command: DesktopCommand) => void): () => void;
  saveArtifact(id: string): Promise<{
    cancelled: boolean;
    fileName?: string;
    path?: string;
    sha256?: string;
  }>;
  restart(): Promise<void>;
}
