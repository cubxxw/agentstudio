import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { NativeIntegrationReply } from "@agentstudio/personal/desktop-contract";

export function localExecutionEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, PATH: [env.PATH, join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean).join(delimiter) };
}

type Flow = { agentId: "codex" | "claude"; child: ChildProcess; progress: NativeIntegrationReply; timer: ReturnType<typeof setTimeout>; killTimer?: ReturnType<typeof setTimeout> };

/** Fixed vendor login only. No command, URL, shell or credential is accepted. */
export class LocalLoginHost {
  private flows = new Map<string, Flow>();
  private stopped = false;
  constructor(private options: { env?: NodeJS.ProcessEnv; onChanged(): void; timeoutMs?: number }) {}

  begin(agentId: "codex" | "claude"): NativeIntegrationReply {
    if (this.stopped) return { state: "failed", message: "应用正在退出，没有开始新的登录。" };
    for (const flow of this.flows.values()) if (flow.agentId === agentId && flow.progress.state === "waiting") return flow.progress;
    const env = localExecutionEnv(this.options.env);
    const command = agentId === "codex" ? env.AGENTSTUDIO_CODEX_BIN || "codex" : "claude";
    const candidates = command.includes("/") ? [command] : String(env.PATH).split(delimiter).filter(Boolean).map(path => join(path, command));
    const executable = candidates.find(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
    if (!executable) return { state: "failed", message: "没有找到这个助手，请先安装后重新检查" };
    const flowId = randomUUID();
    const progress: NativeIntegrationReply = { flowId, state: "waiting", message: "请在助手打开的浏览器页面中完成登录，随后回到这里检查。没有切换模型提供方。" };
    // Ignore all output: it may contain short-lived login links or credentials.
    const child = spawn(realpathSync(executable), agentId === "codex" ? ["login"] : ["auth", "login"], { env, stdio: "ignore", windowsHide: true });
    const flow: Flow = { agentId, child, progress, timer: setTimeout(() => {
      if (flow.progress.state !== "waiting") return;
      flow.progress = { flowId, state: "failed", message: "这次登录等待已结束。可以重新检查登录状态，已有配置不会删除。" };
      this.terminate(flow); this.options.onChanged();
    }, this.options.timeoutMs || 300_000) };
    flow.timer.unref(); this.flows.set(flowId, flow);
    child.once("error", () => { clearTimeout(flow.timer); flow.progress = { flowId, state: "failed", message: "助手登录没有启动，请检查安装后重试" }; this.options.onChanged(); });
    child.once("close", code => {
      clearTimeout(flow.timer); if (flow.killTimer) clearTimeout(flow.killTimer);
      if (flow.progress.state === "waiting") flow.progress = { flowId, state: code === 0 ? "ready" : "failed",
        message: code === 0 ? "登录过程已结束，请重新检查并点击使用这个助手。" : "助手没有确认登录，请重新检查或重试。" };
      this.options.onChanged();
    });
    return progress;
  }

  status(id: string): NativeIntegrationReply { return this.flows.get(id)?.progress || { state: "failed", message: "登录等待已结束，请重新检查状态。" }; }
  cancel(id: string): NativeIntegrationReply {
    const flow = this.flows.get(id);
    if (!flow) return { state: "cancelled", flowId: id };
    if (flow.progress.state !== "waiting") return flow.progress;
    clearTimeout(flow.timer); flow.progress = { state: "cancelled", flowId: id }; this.terminate(flow); return flow.progress;
  }
  private terminate(flow: Flow) {
    if (flow.child.exitCode !== null || flow.child.signalCode !== null) return;
    flow.child.kill("SIGTERM");
    flow.killTimer = setTimeout(() => { if (flow.child.exitCode === null && flow.child.signalCode === null) flow.child.kill("SIGKILL"); }, 1500);
    flow.killTimer.unref();
  }
  stop() { this.stopped = true; for (const [id, flow] of this.flows) if (flow.progress.state === "waiting") this.cancel(id); }
}
