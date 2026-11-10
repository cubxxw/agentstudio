async (page, until) => {
  const base = "http://127.0.0.1:18745";
  const testId = (id) => page.getByTestId(id);
  const checks = [];
  const verify = (condition, name) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const post = async (path, body) => {
    const response = await page.request.post(`${base}/api${path}`, {
      data: body,
    });
    if (!response.ok())
      throw new Error(`Fixture API ${path}: ${response.status()}`);
    return response.json();
  };
  const waitCompleted = async (id) =>
    until(() => page.evaluate(
      async (key) =>
        (await (await fetch(`/api/threads/${key}`)).json()).status ===
        "completed",
      id,
    ));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/?workspace=tasks`);
  await testId("personal-settings").click();
  await testId("personal-tab-memory").click();
  await testId("personal-memory-input").fill(
    "合成验收偏好：先给结论，并保留来源。",
  );
  await testId("personal-memory-save").click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-testid=personal-memory-input]").value ===
      "",
  );
  await page.reload();
  await testId("personal-settings").click();
  await testId("personal-tab-memory").click();
  verify(
    (await testId("personal-modal").innerText()).includes("合成验收偏好"),
    "explicit memory persists after reload",
  );
  await testId("personal-tab-connections").click();
  verify(await testId("personal-connection-type").count() === 0, "protocol configuration is hidden from the default connection flow");
  await testId("personal-own-service").click();
  await testId("personal-own-service-url").fill("http://insecure.invalid");
  await testId("personal-own-service-save").click();
  await testId("personal-integrations-error").waitFor();
  verify(await testId("personal-own-service-url").inputValue() === "http://insecure.invalid", "failed automatic connection preserves its address for correction");
  await testId("personal-own-service-url").fill("http://127.0.0.1:18746");
  await testId("personal-own-service-save").click();
  await until(async () => {
    const data = await (await page.request.get(`${base}/api/bootstrap`)).json();
    return data.connections.some(item => item.name === "合成自动识别助手" && item.type === "a2a");
  });
  verify(true, "one address discovers the agent name and protocol without a token");
  await until(async () => await testId("personal-own-service-save").count() === 0);
  await testId("personal-add-connection").click();
  await testId("personal-connection-name").fill("合成远端助手");
  await testId("personal-connection-url").fill("http://127.0.0.1:18746");
  await testId("personal-connection-save").click();
  await page.waitForFunction(
    () => !document.querySelector("[data-testid=personal-connection-save]"),
  );
  await testId("personal-modal-close").click();
  const bootstrap = await (
    await page.request.get(`${base}/api/bootstrap`)
  ).json();
  const connection = bootstrap.connections.find(
    (item) => item.url === "http://127.0.0.1:18746/",
  );
  verify(
    Boolean(connection),
    "connection address is saved through the interface",
  );
  const before = await (
    await page.request.get("http://127.0.0.1:18746/state")
  ).json();
  await testId("personal-mode-menu").click();
  await testId(`personal-mode-connection-${connection.id}`).click();
  await testId("personal-composer-input").fill(
    "这是合成远端验收，只处理这条测试内容。",
  );
  await testId("personal-composer-send").click();
  await page.waitForURL(/thread=thr_/);
  const remoteId = new URL(page.url()).searchParams.get("thread");
  await testId("personal-decision-approve").waitFor();
  const pendingThread = await (
    await page.request.get(`${base}/api/threads/${remoteId}`)
  ).json();
  const decision = pendingThread.decisions.at(-1);
  verify(
    (await (await page.request.get("http://127.0.0.1:18746/state")).json())
      .submissions === before.submissions,
    "no remote submission precedes approval",
  );
  verify(
    (await testId("personal-decision").innerText()).includes("这条测试内容"),
    "exact submitted material is readable before deciding",
  );
  await page.screenshot({ path: "output/playwright/personal/qa-decision.png" });
  await testId("personal-decision-approve").click();
  await waitCompleted(remoteId);
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-testid=personal-artifact]").length === 1,
  );
  await post(`/decisions/${decision.id}`, {
    choice: "approve",
    version: decision.version,
    clientId: `decision-${decision.id}-${decision.version}-approve`,
  });
  verify(
    (await (await page.request.get("http://127.0.0.1:18746/state")).json())
      .submissions ===
      before.submissions + 1,
    "repeated decision delivers once",
  );
  const returned = await (
    await page.request.get(`${base}/api/threads/${remoteId}`)
  ).json();
  verify(
    returned.runs.at(-1).externalTaskId?.startsWith("synthetic-"),
    "remote task identity remains attached to the result",
  );

  await testId("personal-settings").click();
  await testId("personal-add-connection").click();
  await testId("personal-connection-name").fill("合成凭据助手");
  await testId("personal-connection-url").fill(
    "http://127.0.0.1:18746/authenticated",
  );
  await testId("personal-connection-auth-toggle").click();
  await testId("personal-connection-token").fill(
    "synthetic-browser-only-credential",
  );
  await testId("personal-connection-save").click();
  await page.waitForFunction(
    () => !document.querySelector("[data-testid=personal-connection-save]"),
  );
  await testId("personal-modal-close").click();
  const authenticatedBootstrap = await (
    await page.request.get(`${base}/api/bootstrap`)
  ).json();
  const authenticated = authenticatedBootstrap.connections.find((item) =>
    item.url.endsWith("/authenticated"),
  );
  verify(
    authenticated?.auth?.configured &&
      !JSON.stringify(authenticatedBootstrap).includes(
        "synthetic-browser-only-credential",
      ),
    "credential is saved without returning its value",
  );
  await testId("personal-new").click();
  await testId("personal-mode-menu").click();
  await testId(`personal-mode-connection-${authenticated.id}`).click();
  await testId("personal-composer-input").fill(
    "合成凭据验收，只提交这条测试内容。",
  );
  await testId("personal-composer-send").click();
  await page.waitForURL(/thread=thr_/);
  const authenticatedId = new URL(page.url()).searchParams.get("thread");
  await testId("personal-decision-approve").waitFor();
  verify(
    (await testId("personal-decision").innerText()).includes(
      "使用该连接保存的凭据",
    ),
    "approval names the credential identity without exposing it",
  );
  await testId("personal-decision-approve").click();
  await waitCompleted(authenticatedId);
  verify(
    (await (await page.request.get("http://127.0.0.1:18746/state")).json())
      .authenticatedSubmissions === 1,
    "authenticated submission uses the server-held credential",
  );

  await testId("personal-new").click();
  await testId("personal-mode-menu").click();
  await testId("personal-mode-local").click();
  await testId("personal-composer-input").fill("合成输入法验收：尚在组词。");
  const originalURL = page.url();
  await testId("personal-composer-input").evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 229,
        isComposing: true,
        bubbles: true,
      }),
    ),
  );
  verify(page.url() === originalURL, "IME composition Enter does not send");
  await testId("personal-composer-input").press("Shift+Enter");
  verify(
    (await testId("personal-composer-input").inputValue()).includes("\n") &&
      page.url() === originalURL,
    "Shift Enter inserts a newline",
  );

  let lostThread;
  let lostResponse;
  const observed = new Promise((resolve) => {
    lostResponse = resolve;
  });
  await page.route(`${base}/api/threads`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    lostThread = await response.json();
    await route.abort("failed");
    lostResponse();
  });
  await testId("personal-composer-input").fill(
    "模拟结果送达前断线，重试不能重复创建。",
  );
  await testId("personal-composer-send").click();
  await observed;
  await page.waitForFunction(
    () =>
      !document.querySelector("[data-testid=personal-composer-send]").disabled,
  );
  verify(
    (await testId("personal-composer-input").inputValue()).includes(
      "重试不能重复",
    ),
    "lost response keeps the original draft",
  );
  await page.unroute(`${base}/api/threads`);
  await testId("personal-composer-send").click();
  await page.waitForURL(
    (url) => url.searchParams.get("thread") === lostThread.id,
  );
  await waitCompleted(lostThread.id);
  const deduplicated = await (
    await page.request.get(`${base}/api/threads/${lostThread.id}`)
  ).json();
  verify(
    deduplicated.runs.length === 1 && deduplicated.artifacts.length === 1,
    "retry after a lost response reuses the durable request",
  );

  const historyPrefix = `history-${Date.now()}`;
  for (let index = 0; index < 120; index++)
    await post("/threads", {
      text: `合成历史-${historyPrefix}-${index}：本地保存与检索验收`,
      mode: "local",
      clientId: `${historyPrefix}-${index}`,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  await testId("personal-menu").click();
  await testId("personal-search").fill(`合成历史-${historyPrefix}-119`);
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-testid=personal-thread-row]").length ===
      1,
  );
  verify(
    (await testId("personal-thread-row").innerText()).includes(
      `合成历史-${historyPrefix}-119`,
    ),
    "search reaches the last of 120 persisted things",
  );
  await page.screenshot({
    path: "output/playwright/personal/qa-history-search.png",
  });
  await testId("personal-thread-row").click();
  verify(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "history selection remains usable at 390px",
  );
  return {
    synthetic: true,
    checks,
    remoteId,
    deduplicatedId: lostThread.id,
    historyCount: 120,
  };
};
