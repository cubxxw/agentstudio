// Isolated browser acceptance host. Never invokes a real model or account.
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPersonalServer } from "../apps/personal/server/index.mjs";

const dataDir =
  process.env.PERSONAL_QA_DATA_DIR ||
  mkdtempSync(join(tmpdir(), "agentstudio-browser-qa-"));
const port = Number(process.env.PERSONAL_QA_PORT || 18745);
const tasks = new Map();
let submissions = 0;
let authenticatedSubmissions = 0;
const fixture = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/state") {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        synthetic: true,
        submissions,
        authenticatedSubmissions,
      }),
    );
    return;
  }
  let body = "";
  if (
    request.url === "/authenticated" &&
    request.headers.authorization !== "Bearer synthetic-browser-only-credential"
  ) {
    response.writeHead(401).end();
    return;
  }
  for await (const chunk of request) body += chunk;
  try {
    const rpc = JSON.parse(body);
    let result;
    if (rpc.method === "message/send") {
      if (request.url === "/authenticated") authenticatedSubmissions += 1;
      const taskId = `synthetic-${++submissions}`;
      result = {
        kind: "task",
        id: taskId,
        status: { state: "completed" },
        artifacts: [
          {
            artifactId: "synthetic-report",
            parts: [
              {
                kind: "text",
                text: "# 合成远端验收结果\n\n这份结果由本机隔离测试服务返回，没有调用真实模型或第三方账号。\n\n- 资料接收一次\n- 结果可保存和回查\n",
              },
            ],
          },
        ],
      };
      tasks.set(taskId, result);
    } else if (rpc.method === "tasks/get") result = tasks.get(rpc.params.id);
    else throw new Error("Unsupported fixture request");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  } catch {
    response.writeHead(400).end();
  }
});
await new Promise((resolveListen) =>
  fixture.listen(port + 1, "127.0.0.1", resolveListen),
);
const app = await createPersonalServer({
  dataDir,
  port,
  codexCommand: "agentstudio-intentionally-unavailable-qa-cli",
  staticDir: resolve("apps/personal/dist"),
});
await app.listen();
console.log(
  JSON.stringify({
    synthetic: true,
    url: `http://127.0.0.1:${port}`,
    fixture: `http://127.0.0.1:${port + 1}`,
    dataDir,
  }),
);
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await app.close();
    fixture.close();
  });
