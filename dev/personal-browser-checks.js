// The complete reading/recovery journey uses the same messenger as contacts.
async (page, until) => {
  const checks = [], base = "http://127.0.0.1:18745", shot = "output/playwright/personal";
  const testId = id => page.getByTestId(id);
  const verify = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
  const get = async path => (await page.request.get(`${base}/api${path}`)).json();
  const waitCompleted = (id, count = 1) => until(async () => { const t = await get(`/threads/${id}`); return t.status === "completed" && t.artifacts.length >= count; });
  const result = async () => { await testId("im-results").click(); await testId("im-artifact").last().click(); await testId("personal-reader").waitFor(); };
  const closeResult = async () => { await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); };
  const notes = async () => { await testId("im-new").click(); await testId("im-new-notes").click(); };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/?thread=new`);
  await testId("im-message-input").fill("这段未发送的中文草稿，刷新后应接上。");
  await page.reload();
  verify(await testId("im-message-input").inputValue() === "这段未发送的中文草稿，刷新后应接上。", "unsent draft survives reload");
  await testId("im-message-input").fill("合成阅读验收：保存这段资料。");
  await testId("im-send").click(); await page.waitForURL(/thread=thr_/);
  const threadId = new URL(page.url()).searchParams.get("thread"); await waitCompleted(threadId);
  verify(await testId("im-task-mode").inputValue() === "local", "explicit local mode stays local after send");
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

  await testId("im-attach").setInputFiles({ name: "synthetic-long-report.md", mimeType: "text/markdown", buffer: Buffer.from(long) });
  await testId("im-message-input").fill("请保留这份合成原文的结构，整理资料统计。");
  let release, observed;
  const reached = new Promise(r => { observed = r; });
  const messageURL = `${base}/api/threads/${threadId}/messages`;
  await page.route(messageURL, async route => { observed(); await new Promise(r => { release = r; }); await route.continue(); });
  await testId("im-send").click(); await reached;
  await testId("im-message-input").fill("发送过程中继续写的下一段草稿。"); release();
  await waitCompleted(threadId, 2);
  await until(async () => await testId("im-send").isEnabled());
  verify(await testId("im-message-input").inputValue() === "发送过程中继续写的下一段草稿。", "typing during send is preserved");
  await page.unroute(messageURL); await result();
  const reader = testId("personal-reader");
  await until(async () => (await reader.innerText()).includes("LONG-SOURCE-END"));
  verify((await reader.locator("strong").filter({ hasText: "结论：" }).count()) > 0, "Chinese punctuation emphasis remains bold");
  verify((await reader.locator("del").filter({ hasText: "旧结论。" }).count()) > 0, "strikethrough remains readable");
  verify(await reader.locator("table").count() >= 2, "source and generated tables remain readable");
  verify(await reader.locator("pre code").count() >= 1, "code remains a code block");
  verify(await page.evaluate(() => window.__personalUnsafeMarkup !== true), "source HTML never executes");
  verify(await reader.locator('a[href="https://ia.net/writer"]').count() > 0, "source link remains reachable");
  const downloadURL = await testId("personal-reader-download").getAttribute("href");
  const download = await page.evaluate(async url => {
    const r = await fetch(url), bytes = await r.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2,"0")).join("");
    return { ok: r.ok, disposition: r.headers.get("content-disposition"), hash, text: new TextDecoder().decode(bytes) };
  }, downloadURL);
  const saved = await get(`/threads/${threadId}`), artifact = saved.artifacts.at(-1);
  verify(download.ok && download.disposition.includes("attachment") && download.hash === artifact.sha256 && download.text.includes("LONG-SOURCE-END"), "download matches the saved artifact fingerprint and retains its full source");
  await reader.evaluate(node => { node.scrollTop = 480; });
  await until(async () => await reader.evaluate(node => node.scrollTop > 0));
  const scroll = await reader.evaluate(node => node.scrollTop);
  await page.screenshot({ path: `${shot}/qa-reader-desktop.png` }); await closeResult();
  verify(await testId("im-message-input").inputValue() === "发送过程中继续写的下一段草稿。", "closing reader retains the conversation draft");
  await result(); await until(async () => Math.abs(await reader.evaluate(node => node.scrollTop) - scroll) < 3);
  checks.push("reader position returns"); await closeResult();
  await testId("im-skip").focus(); await page.keyboard.press("Enter");
  verify(new URL(page.url()).searchParams.get("thread") === threadId, "internal fragment does not become a conversation route");
  await notes();
  if (!await testId("im-task-mode").isVisible()) await testId("im-send-options-toggle").click();
  await testId("im-task-mode").selectOption("codex");
  await testId("im-message-input").fill("合成错误验收：本隔离环境故意没有 CLI。"); await testId("im-send").click();
  await page.waitForURL(/thread=thr_/); const blockedId = new URL(page.url()).searchParams.get("thread");
  await until(async () => (await get(`/threads/${blockedId}`)).status === "blocked");
  verify((await get(`/threads/${blockedId}`)).artifacts.length === 0, "missing executor never creates successful output");
  await page.screenshot({ path: `${shot}/qa-blocked-desktop.png` });
  await page.goto(`${base}/?workspace=tasks&thread=${threadId}`);
  await testId("im-message-input").fill("网络中断时仍保留的草稿。"); await page.context().setOffline(true);
  await until(async () => (await page.locator("body").innerText()).includes("连接中断"));
  verify(await testId("im-message-input").inputValue() === "网络中断时仍保留的草稿。", "offline state preserves editable draft");
  await page.screenshot({ path: `${shot}/qa-offline.png` }); await page.context().setOffline(false);
  await until(async () => await testId("im-send").isEnabled()); checks.push("reconnection reloads authoritative state");
  await page.setViewportSize({ width: 390, height: 844 });
  verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "390px conversation has no page overflow");
  await result();
  verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "390px reader has no page overflow");
  await page.screenshot({ path: `${shot}/qa-reader-narrow.png` }); await closeResult();
  await page.emulateMedia({ reducedMotion: "reduce" });
  verify(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), "reduced-motion preference is observed");
  await testId("im-back").click(); await testId("im-search").fill("合成阅读验收");
  await page.getByTestId(`im-chat-${threadId}`).click();
  verify(!await testId("im-search").isVisible(), "closed narrow chat list is outside keyboard navigation");
  await page.screenshot({ path: `${shot}/qa-conversation-narrow.png` }); await page.setViewportSize({ width: 1440, height: 1000 });
  const sourceId = saved.messages.flatMap(item => item.attachments || [])[0].id;
  await testId("im-message-input").fill(`请核对[已保存资料](#source-${sourceId})。`); await testId("im-send").click();
  await waitCompleted(threadId, 3); await result();
  await reader.locator('a[href^="#source-"]').first().click();
  await until(async () => await page.getByTestId("personal-modal").count() === 3);
  checks.push("report citation opens the original saved source"); await page.keyboard.press("Escape");
  verify(await reader.isVisible() && await page.getByTestId("personal-modal").count() === 2, "Escape closes only the top source and retains the report");
  return { synthetic: true, checks, threadId, blockedId };
};
