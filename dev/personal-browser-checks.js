// Run this function with playwright-cli run-code against dev/personal-qa.mjs.
// All data and remote actions are synthetic. No real model is invoked.
async (page) => {
  const checks = [];
  const verify = (condition, name) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const base = "http://127.0.0.1:18745";
  const shot = "output/playwright/personal";
  const testId = (id) => page.getByTestId(id);
  const waitCompleted = async (id, count = 1) =>
    page.waitForFunction(
      async ({ id, count }) => {
        const response = await fetch(`/api/threads/${id}`);
        const thread = await response.json();
        return (
          thread.status === "completed" && thread.artifacts.length >= count
        );
      },
      { id, count },
      { timeout: 30000, polling: 200 },
    );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await testId("personal-app").waitFor();
  await testId("personal-composer-input").fill(
    "这段未发送的中文草稿，刷新后应接上。",
  );
  await page.reload();
  verify(
    (await testId("personal-composer-input").inputValue()) ===
      "这段未发送的中文草稿，刷新后应接上。",
    "unsent draft survives reload",
  );
  await testId("personal-composer-input").fill("");
  await testId("personal-sample").click();
  await page.waitForURL(/thread=thr_/);
  const threadId = new URL(page.url()).searchParams.get("thread");
  await waitCompleted(threadId);
  await testId("personal-artifact").first().waitFor();
  verify(
    (await testId("personal-mode-menu").innerText()).includes("本地整理"),
    "explicit local mode stays local after send",
  );
  const long =
    "# 中文长内容验收\n\n> 以下为合成材料，不是真实业务记录。\n\n**结论：**中文标点后的强调。\n\n~~旧结论。~~新的内容。\n\n" +
    Array.from(
      { length: 18 },
      (_, i) =>
        `## 第 ${i + 1} 节\n\n这是一段用于持续阅读的中文内容。AgentStudio 需要保留中英混排、数字 2026.11、标点，以及明确的来源。我们在这里检查行宽、字阶和留白，而不是虚构业务结论。\n\n`,
    ).join("") +
    '\n| 阶段 | 资料一 | 资料二 | 资料三 | 资料四 | 资料五 | 资料六 | 资料七 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 比较 | 公开信息 | 合成材料 | 待核实 | 已保存 | 已校验 | 有来源 | 可继续 |\n\n```js\nconst longLine = "' +
    "abcdef".repeat(80) +
    '";\n```\n\n参考：[官方资料](https://ia.net/writer)\n\n<script>window.__personalUnsafeMarkup = true</script>\n\n最后一行：LONG-SOURCE-END\n';
  await testId("personal-attachment-input").setInputFiles({
    name: "synthetic-long-report.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(long),
  });
  await testId("personal-composer-input").fill(
    "请保留这份合成原文的结构，整理资料统计。",
  );
  let release;
  let intercepted;
  const reached = new Promise((resolveReached) => {
    intercepted = resolveReached;
  });
  const messageURL = `${base}/api/threads/${threadId}/messages`;
  await page.route(messageURL, async (route) => {
    intercepted();
    await new Promise((resolveRelease) => {
      release = resolveRelease;
    });
    await route.continue();
  });
  await testId("personal-composer-send").click();
  await reached;
  await testId("personal-composer-input").fill(
    "发送过程中继续写的下一段草稿。",
  );
  release();
  await waitCompleted(threadId, 2);
  await page.waitForFunction(
    () =>
      !document.querySelector("[data-testid=personal-composer-send]")?.disabled,
  );
  verify(
    (await testId("personal-composer-input").inputValue()) ===
      "发送过程中继续写的下一段草稿。",
    "typing during send is preserved",
  );
  await page.unroute(messageURL);
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-testid=personal-artifact]").length === 2,
  );
  await testId("personal-artifact").last().click();
  await testId("personal-reader").waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-testid=personal-reader]")
      ?.textContent.includes("LONG-SOURCE-END"),
  );
  verify(
    (await testId("personal-reader").innerText()).includes("LONG-SOURCE-END"),
    "full source survives beyond long content",
  );
  verify(
    (await testId("personal-reader").locator("strong").filter({ hasText: "结论：" }).count()) > 0,
    "Chinese punctuation retains Markdown emphasis",
  );
  verify(
    (await testId("personal-reader").locator("del").filter({ hasText: "旧结论。" }).count()) > 0,
    "Chinese punctuation retains Markdown strikethrough",
  );
  verify(
    (await testId("personal-reader").locator("table").count()) >= 2,
    "Markdown tables remain structured",
  );
  verify(
    (await testId("personal-reader").locator("pre code").count()) >= 1,
    "code remains a code block",
  );
  verify(
    await page.evaluate(() => window.__personalUnsafeMarkup !== true),
    "source HTML never executes",
  );
  verify(
    (await testId("personal-reader")
      .locator('a[href="https://ia.net/writer"]')
      .count()) > 0,
    "source link remains reachable",
  );
  const downloadURL = await testId("personal-reader-download").getAttribute(
    "href",
  );
  await testId("personal-reader-download").click();
  const downloaded = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const bytes = await response.arrayBuffer();
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return {
      ok: response.ok,
      disposition: response.headers.get("content-disposition"),
      hash,
    };
  }, downloadURL);
  verify(
    downloaded.ok && downloaded.disposition.includes(".md"),
    "Markdown result downloads as a file",
  );
  const metadata = await page.evaluate(
    async (id) =>
      (await (await fetch(`/api/threads/${id}`)).json()).artifacts.at(-1),
    threadId,
  );
  verify(
    downloaded.hash === metadata.sha256,
    "download bytes match saved SHA-256",
  );
  await testId("personal-reader").evaluate((element) => {
    element.scrollTop = 500;
  });
  await page.screenshot({ path: `${shot}/qa-reader-desktop.png` });
  await page.keyboard.press("Escape");
  verify(
    (await testId("personal-composer-input").inputValue()) ===
      "发送过程中继续写的下一段草稿。",
    "reader closes into unchanged draft",
  );
  await testId("personal-artifact").last().click();
  await testId("personal-reader").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-testid=personal-reader]").scrollTop >= 450,
  );
  checks.push("reader position returns");
  await page.keyboard.press("Escape");
  await testId("personal-skip").focus();
  await page.keyboard.press("Enter");
  verify(
    new URL(page.url()).searchParams.get("thread") === threadId,
    "internal fragment does not become a task route",
  );
  await testId("personal-new").click();
  await testId("personal-composer-input").fill(
    "合成错误验收：本隔离环境故意没有 CLI。",
  );
  await testId("personal-composer-send").click();
  await page.waitForURL(/thread=thr_/);
  const blockedId = new URL(page.url()).searchParams.get("thread");
  await page.waitForFunction(
    async (id) =>
      (await (await fetch(`/api/threads/${id}`)).json()).status === "blocked",
    blockedId,
  );
  verify(
    (await testId("personal-artifact").count()) === 0,
    "missing executor never creates successful output",
  );
  await page.screenshot({ path: `${shot}/qa-blocked-desktop.png` });
  await page.goto(`${base}/?thread=${threadId}`);
  await testId("personal-artifact").last().waitFor();
  await testId("personal-composer-input").fill("网络中断时仍保留的草稿。");
  await page.context().setOffline(true);
  await page.waitForFunction(
    () => document.body.innerText.includes("暂时连不上本机服务"),
    null,
    { timeout: 30000 },
  );
  verify(
    (await testId("personal-composer-input").inputValue()) ===
      "网络中断时仍保留的草稿。",
    "offline state preserves editable draft",
  );
  await page.screenshot({ path: `${shot}/qa-offline.png` });
  await page.context().setOffline(false);
  await page.waitForFunction(
    () => !document.body.innerText.includes("暂时连不上本机服务"),
    null,
    { timeout: 30000 },
  );
  checks.push("reconnection reloads authoritative state");
  await page.setViewportSize({ width: 390, height: 844 });
  verify(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "390px conversation has no page overflow",
  );
  await testId("personal-artifact").last().click();
  await testId("personal-reader").waitFor();
  verify(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "390px reader has no page overflow",
  );
  await page.screenshot({ path: `${shot}/qa-reader-narrow.png` });
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  verify(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    "reduced-motion preference is observed",
  );
  await testId("personal-menu").click();
  await testId("personal-search").fill("合成");
  await testId("personal-sidebar-close").click();
  verify(
    (await testId("personal-sidebar").getAttribute("inert")) !== null,
    "closed narrow sidebar is outside keyboard navigation",
  );
  await page.screenshot({ path: `${shot}/qa-conversation-narrow.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const saved = await (
    await page.request.get(`${base}/api/threads/${threadId}`)
  ).json();
  const sourceId = saved.messages.flatMap((item) => item.attachments ?? [])[0].id;
  await testId("personal-composer-input").fill(`请核对[已保存资料](#source-${sourceId})。`);
  await testId("personal-composer-send").click();
  await waitCompleted(threadId, 3);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=personal-artifact]').length === 3,
  );
  await testId("personal-artifact").last().click();
  await testId("personal-reader").locator('a[href^="#source-"]').first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('dialog[open]').length === 2,
  );
  checks.push("report citation opens the original saved source");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelectorAll('dialog[open]').length === 1,
  );
  verify(
    await testId("personal-reader").isVisible(),
    "Escape closes only the top source and retains the report",
  );
  return { synthetic: true, checks, threadId, blockedId };
};
