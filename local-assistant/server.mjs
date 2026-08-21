import http from "node:http";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";

const HOST = "127.0.0.1";
const PORT = 8765;
const SITE_ORIGINS = new Set([
  "https://xintan-talent-radar.iyihioh.chatgpt.site",
  "http://localhost:3000",
  "http://localhost:5173",
]);
const PLATFORM_URLS = {
  "抖音": "https://www.douyin.com/",
  "微博": "https://weibo.com/",
  "小红书": "https://www.xiaohongshu.com/explore",
  "知乎": "https://www.zhihu.com/",
  "EDA365": "https://bbs.eda365.com/forum.php",
};
const SOCIAL_PLATFORMS = ["抖音", "微博", "小红书", "知乎"];
const searchJobs = new Map();
const verificationQueries = ["芯片", "设计"];
let operationQueue = Promise.resolve();
const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_FILE = resolve(PROJECT_DIR, "work", "local-assistant-sessions.json");
const AI_SETTINGS_FILE = resolve(PROJECT_DIR, "work", "ai-brain-settings.json");
const BROWSER_PROFILE_DIR = resolve(PROJECT_DIR, "work", "browser-profile");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(resolve(PROJECT_DIR, "work"), { recursive: true });
let sessionStates = Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform, { status: "unknown", lastCheckedAt: new Date().toISOString() }]));
let verificationStates = {};
const DEFAULT_AI_SETTINGS = {
  provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", apiKey: "",
  status: "not_configured", lastTestAt: "", lastError: "",
  policy: {
    maxStepsPerSource: 24, maxItemsPerSource: 12, allowOpenDetail: true, allowReadComments: true,
    allowRefineSearch: true, allowCrossPlatformSuggestion: true,
  },
};
let aiSettings = structuredClone(DEFAULT_AI_SETTINGS);
try {
  const saved = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  if (saved?.profile === "xintan-dedicated-v1") {
    sessionStates = { ...sessionStates, ...saved.sessions };
    verificationStates = saved.verifications ?? {};
  }
} catch { /* first launch */ }
try {
  const saved = JSON.parse(readFileSync(AI_SETTINGS_FILE, "utf8"));
  aiSettings = { ...DEFAULT_AI_SETTINGS, ...saved, policy: { ...DEFAULT_AI_SETTINGS.policy, ...(saved.policy ?? {}) } };
} catch { /* configured from AI center later */ }
delete verificationStates.EETOP;
let browserContext;
let browserConnection;
let operatorPage;

function saveSessions() {
  writeFileSync(SESSION_FILE, JSON.stringify({ profile: "xintan-dedicated-v1", sessions: sessionStates, verifications: verificationStates }, null, 2));
}

function publicAiSettings() {
  return {
    provider: aiSettings.provider, baseUrl: aiSettings.baseUrl, model: aiSettings.model,
    hasApiKey: Boolean(aiSettings.apiKey), status: aiSettings.status, lastTestAt: aiSettings.lastTestAt,
    lastError: aiSettings.lastError, policy: aiSettings.policy,
    allowedActions: ["检索", "滚动", "读取公开内容", "打开站内原文", "读取公开评论", "调整关键词", "建议跨平台核验", "返回"],
    blockedActions: ["私信", "评论或发布", "点赞关注", "上传下载", "输入密码或验证码", "绕过人机验证", "访问非白名单域名"],
  };
}

function saveAiSettings() {
  writeFileSync(AI_SETTINGS_FILE, JSON.stringify(aiSettings, null, 2));
  chmodSync(AI_SETTINGS_FILE, 0o600);
}

const AI_DECISION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["keep", "filter", "needs_more"] },
    reasoningSummary: { type: "string" },
    nextAction: { type: "string", enum: ["keep", "filter", "open_source", "read_comments", "refine_search", "scroll_next", "cross_check", "stop"] },
    actionReason: { type: "string" }, searchQuery: { type: "string" }, crossCheckPlatform: { type: "string" },
    tags: { type: "array", items: { type: "string" }, maxItems: 8 },
    matchedKeywords: { type: "array", items: { type: "string" }, maxItems: 10 },
    intent: { type: "string", enum: ["强", "中", "无"] },
    intelligenceType: { type: "string", enum: ["人才线索", "企业情报", "无效内容"] },
    score: { type: "integer", minimum: 0, maximum: 100 }, priority: { type: "string", enum: ["A", "B", "C"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }, stopReason: { type: "string" },
  },
  required: ["decision", "reasoningSummary", "nextAction", "actionReason", "searchQuery", "crossCheckPlatform", "tags", "matchedKeywords", "intent", "intelligenceType", "score", "priority", "confidence", "stopReason"],
};

function responseOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) if (typeof content.text === "string") return content.text;
  }
  return "";
}

async function askAiBrain(observation) {
  if (!aiSettings.apiKey || aiSettings.status !== "connected") throw new Error("AI中枢尚未配置并通过连接测试");
  const endpoint = `${String(aiSettings.baseUrl).replace(/\/$/, "")}/responses`;
  const response = await fetch(endpoint, {
    method: "POST", signal: AbortSignal.timeout(45_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiSettings.apiKey}` },
    body: JSON.stringify({
      model: aiSettings.model, store: false, max_output_tokens: 900,
      instructions: `你是芯片设计行业猎头情报Agent的中央决策大脑。只分析公开或已授权内容。你只能从给定的安全动作中选择下一步，绝不能私信、发布、点赞、关注、上传、下载、输入密码/验证码、绕过验证或离开平台白名单域名。先判断内容是否与任务技术栈、企业或求职/企业信号相关；信息不足时可要求打开站内原文或读取公开评论；输出简短可审计的决策摘要，不输出隐藏思维链。`,
      input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(observation) }] }],
      text: { format: { type: "json_schema", name: "talent_agent_decision", strict: true, schema: AI_DECISION_SCHEMA } },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? `AI服务返回 ${response.status}`);
  const output = responseOutputText(payload);
  if (!output) throw new Error("AI中枢没有返回结构化决策");
  return { ...JSON.parse(output), model: payload.model ?? aiSettings.model, responseId: payload.id ?? "" };
}

function enforceAgentPolicy(decision, job, item) {
  const blocked = [];
  let action = decision.nextAction;
  if (action === "open_source" && !aiSettings.policy.allowOpenDetail) blocked.push("策略禁止打开详情");
  if (action === "read_comments" && !aiSettings.policy.allowReadComments) blocked.push("策略禁止读取评论");
  if (action === "refine_search" && !aiSettings.policy.allowRefineSearch) blocked.push("策略禁止调整关键词");
  if (action === "cross_check" && !aiSettings.policy.allowCrossPlatformSuggestion) blocked.push("策略禁止跨平台建议");
  try {
    const sourceHost = new URL(PLATFORM_URLS[job.platform]).hostname.replace(/^www\./, "");
    const targetHost = new URL(item.url).hostname.replace(/^www\./, "");
    if (!targetHost.endsWith(sourceHost)) blocked.push("目标超出平台白名单域名");
  } catch { blocked.push("目标URL无效"); }
  if (blocked.length) action = decision.decision === "keep" ? "keep" : "filter";
  return { allowed: blocked.length === 0, action, reason: blocked.join("；") || "动作通过安全策略" };
}

async function ensureBrowser() {
  if (browserContext) return browserContext;
  try {
    browserConnection = await chromium.connectOverCDP("http://127.0.0.1:9222");
    browserContext = browserConnection.contexts()[0];
    if (browserContext) {
      browserConnection.on("disconnected", () => { browserConnection = undefined; browserContext = undefined; });
      return browserContext;
    }
  } catch { /* start a dedicated browser below */ }
  browserContext = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    executablePath: CHROME_PATH,
    headless: false,
    viewport: null,
    args: ["--window-size=760,620", "--window-position=80,70", "--remote-debugging-port=9222", "--disable-blink-features=AutomationControlled"],
  });
  browserContext.on("close", () => { browserContext = undefined; });
  return browserContext;
}

async function openControlledPage(target) {
  const context = await ensureBrowser();
  const page = operatorPage && !operatorPage.isClosed() ? operatorPage : await context.newPage();
  operatorPage = page;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  try {
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", { windowId, bounds: { left: 80, top: 70, width: 760, height: 620, windowState: "normal" } });
    await session.detach();
  } catch { /* window is still usable when resizing is unavailable */ }
  await page.bringToFront();
  return page;
}

function searchUrl(platform, queries) {
  const keyword = queries.filter(Boolean).slice(0, 8).join(" ").trim();
  const encoded = encodeURIComponent(keyword);
  if (platform === "抖音") return `https://www.douyin.com/search/${encoded}?type=general`;
  if (platform === "微博") return `https://s.weibo.com/weibo?q=${encoded}`;
  if (platform === "小红书") return `https://www.xiaohongshu.com/search_result?keyword=${encoded}`;
  if (platform === "知乎") return `https://www.zhihu.com/search?type=content&q=${encoded}`;
  return PLATFORM_URLS[platform];
}

function isContentUrl(platform, parsed) {
  const target = `${parsed.pathname}${parsed.search}`;
  if (platform === "抖音") return /\/(video|note)\//.test(target);
  if (platform === "微博") return /^\/\d+\/[A-Za-z0-9]+/.test(parsed.pathname) || /\/status\//.test(parsed.pathname);
  if (platform === "小红书") return /\/(explore|discovery\/item)\//.test(parsed.pathname);
  if (platform === "知乎") return /\/(question|p)\//.test(parsed.pathname) || /\/answer\//.test(parsed.pathname);
  if (platform === "EDA365") return /thread-|mod=viewthread|tid=/.test(target);
  return true;
}

async function showItemAnalysis(page, item, analysis, position, total, stage) {
  const locator = page.locator(`[data-xintan-candidate="${item.marker}"]`).first();
  if (await locator.count()) {
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
    await locator.evaluate((element) => {
      document.querySelectorAll("[data-xintan-active='1']").forEach((active) => {
        active.removeAttribute("data-xintan-active");
        active.style.outline = "";
        active.style.outlineOffset = "";
      });
      const container = element.closest("article, li, [role='listitem']") || element;
      container.setAttribute("data-xintan-active", "1");
      container.style.outline = "3px solid #635bff";
      container.style.outlineOffset = "4px";
    }).catch(() => undefined);
  }
  await page.evaluate(({ platform, position, total, stage, snippet, analysis }) => {
    let overlay = document.querySelector("#xintan-analysis-overlay");
    if (!overlay) {
      overlay = document.createElement("aside");
      overlay.id = "xintan-analysis-overlay";
      Object.assign(overlay.style, {
        position: "fixed", top: "18px", right: "18px", zIndex: "2147483647", width: "330px",
        padding: "16px", borderRadius: "12px", background: "rgba(16,18,24,.96)", color: "white",
        boxShadow: "0 18px 60px rgba(0,0,0,.34)", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      });
      document.documentElement.appendChild(overlay);
    }
    overlay.textContent = "";
    const heading = document.createElement("strong");
    heading.textContent = `芯探 · ${platform} · ${position}/${total}`;
    Object.assign(heading.style, { display: "block", color: "#aaa7ff", fontSize: "13px", marginBottom: "10px" });
    const status = document.createElement("div");
    status.textContent = stage === "reading" ? "正在阅读这条内容…" : `${analysis.decision} · ${analysis.priority}级 · ${analysis.score}分`;
    Object.assign(status.style, { fontSize: "15px", fontWeight: "700", marginBottom: "8px" });
    const excerpt = document.createElement("p");
    excerpt.textContent = snippet.slice(0, 150);
    Object.assign(excerpt.style, { margin: "0 0 10px", color: "#d7d9e0", fontSize: "12px", lineHeight: "1.6" });
    const reason = document.createElement("p");
    reason.textContent = stage === "reading" ? "提取关键词、求职信号与企业事件" : analysis.reason;
    Object.assign(reason.style, { margin: "0", color: stage === "reading" ? "#9da2af" : analysis.keep ? "#70d9b0" : "#ffadad", fontSize: "12px", lineHeight: "1.5" });
    overlay.append(heading, status, excerpt, reason);
  }, { platform: item.platform, position, total, stage, snippet: item.snippet, analysis }).catch(() => undefined);
}

async function prepareSearchPage(page, platform, queries) {
  if (SOCIAL_PLATFORMS.includes(platform)) return { performed: true, method: "direct_url" };
  const forumSearchUrl = new URL("/search.php?mod=forum", PLATFORM_URLS[platform]).toString();
  await page.goto(forumSearchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  let searchInput = page.locator("input#scform_srchtxt:visible, input#srchtxt:visible, input[name='srchtxt']:visible, input[name='keyword']:visible, input[type='search']:visible").first();
  if (!(await searchInput.count())) {
    const searchLink = page.locator("a[href*='search.php']:visible, a:has-text('搜索'):visible").first();
    if (await searchLink.count()) {
      await searchLink.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      searchInput = page.locator("input#scform_srchtxt:visible, input#srchtxt:visible, input[name='srchtxt']:visible, input[name='keyword']:visible, input[type='search']:visible").first();
    }
  }
  if (await searchInput.count()) {
    await searchInput.fill(queries.slice(0, 6).join(" "), { timeout: 5000 });
    await searchInput.press("Enter", { timeout: 5000 });
    await page.waitForTimeout(2500);
    return { performed: true, method: "search_input" };
  }
  return { performed: false, method: "unavailable" };
}

async function verifyPlatform(platform) {
  const startedAt = new Date().toISOString();
  const checks = [];
  const record = (key, label, passed, detail) => checks.push({ key, label, status: passed ? "passed" : "failed", detail });
  try {
    const destination = searchUrl(platform, verificationQueries);
    const page = await openControlledPage(destination);
    const searchAction = await prepareSearchPage(page, platform, verificationQueries);
    await page.waitForTimeout(2200);

    let bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const pageTitle = await page.title().catch(() => "");
    const pageUrl = page.url();
    const accessGate = /人机验证|安全验证|访问验证|captcha|challenge/i.test(`${pageTitle} ${bodyText.slice(0, 2000)}`);
    record("page", "网页打开", bodyText.trim().length > 30 && !pageUrl.startsWith("chrome-error://") && !accessGate, accessGate ? "页面进入人机或安全验证" : `${pageTitle || platform} · ${pageUrl}`);

    const loginGate = /(?:passport|login|signin)/i.test(pageUrl) || /请先登录|登录后(?:继续|查看)|扫码登录/.test(bodyText.slice(0, 6000));
    if (SOCIAL_PLATFORMS.includes(platform)) record("account", "账号会话", !loginGate, loginGate ? "页面仍要求登录" : "未发现登录拦截");

    const joinedKeyword = verificationQueries.join(" ");
    const searchDetected = SOCIAL_PLATFORMS.includes(platform)
      ? searchAction.performed && pageUrl !== PLATFORM_URLS[platform] && (decodeURIComponent(pageUrl).includes(verificationQueries[0]) || bodyText.includes(verificationQueries[0]))
      : searchAction.performed && (bodyText.includes(verificationQueries[0]) || bodyText.includes(joinedKeyword) || /search/i.test(pageUrl));
    record("search", "关键词查找", searchDetected, searchDetected ? `已执行“${joinedKeyword}”检索` : "未确认检索结果页");

    const beforeScroll = await page.evaluate(() => {
      const root = document.scrollingElement;
      const candidates = Array.from(document.querySelectorAll("*")).filter((element) => element.scrollHeight > element.clientHeight + 40);
      const nested = candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
      return { rootTop: root?.scrollTop ?? 0, rootMax: root ? root.scrollHeight - root.clientHeight : 0, nestedTop: nested?.scrollTop ?? 0, nestedMax: nested ? nested.scrollHeight - nested.clientHeight : 0 };
    }).catch(() => ({ rootTop: 0, rootMax: 0, nestedTop: 0, nestedMax: 0 }));
    await page.mouse.move(700, 500).catch(() => undefined);
    await page.mouse.wheel(0, 1100).catch(() => undefined);
    await page.waitForTimeout(1000);
    const afterScroll = await page.evaluate(() => {
      const root = document.scrollingElement;
      const candidates = Array.from(document.querySelectorAll("*")).filter((element) => element.scrollHeight > element.clientHeight + 40);
      const nested = candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
      return { rootTop: root?.scrollTop ?? 0, rootMax: root ? root.scrollHeight - root.clientHeight : 0, nestedTop: nested?.scrollTop ?? 0, nestedMax: nested ? nested.scrollHeight - nested.clientHeight : 0 };
    }).catch(() => ({ rootTop: 0, rootMax: 0, nestedTop: 0, nestedMax: 0 }));
    const canScroll = beforeScroll.rootMax > 0 || beforeScroll.nestedMax > 0;
    const didScroll = afterScroll.rootTop > beforeScroll.rootTop || afterScroll.nestedTop > beforeScroll.nestedTop;
    record("scroll", "滚轮滚动", canScroll && didScroll, !canScroll ? "当前页面没有可滚动内容" : didScroll ? "页面已产生滚动位移" : "页面可滚动，但滚轮未产生位移");

    bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => bodyText);
    const anchors = await page.locator("a[href]").evaluateAll((elements) => elements.map((element) => ({
      url: element.href,
      text: String((element.closest("article, li, [role='listitem']") || element).innerText || "").replace(/\s+/g, " ").trim(),
    }))).catch(() => []);
    const readable = bodyText.replace(/\s+/g, " ").trim().length;
    record("read", "内容读取", readable >= 80 && anchors.length > 0, `读取 ${readable} 个字符、${anchors.length} 个链接`);
    const expectedHost = new URL(PLATFORM_URLS[platform]).hostname.replace(/^www\./, "");
    const sourceLinks = anchors.filter((item) => {
      try { return new URL(item.url).hostname.replace(/^www\./, "").endsWith(expectedHost) && item.text.length >= 4; }
      catch { return false; }
    });
    record("link", "来源链接", sourceLinks.length > 0, sourceLinks.length ? `识别 ${sourceLinks.length} 个站内来源链接` : "没有识别到可回溯链接");

    const passed = checks.every((check) => check.status === "passed");
    const result = { platform, status: passed ? "passed" : "failed", checks, testedAt: new Date().toISOString(), startedAt, pageUrl: page.url() };
    verificationStates[platform] = result;
    saveSessions();
    return result;
  } catch (error) {
    const result = {
      platform, status: "failed", checks, testedAt: new Date().toISOString(), startedAt,
      error: error instanceof Error ? error.message : "功能验收失败",
    };
    verificationStates[platform] = result;
    saveSessions();
    return result;
  }
}

async function processSearchJob(job, queries) {
  try {
    const page = await openControlledPage(job.searchUrl);
    await prepareSearchPage(page, job.platform, queries);
    searchJobs.set(job.jobId, { ...job, status: "running", phase: "locating", progress: 20, currentAction: `正在${job.platform}核对检索词：${queries.slice(0, 5).join("、")}`, analysisTrace: [] });
    await page.waitForTimeout(2200);
    const expectedHost = new URL(PLATFORM_URLS[job.platform]).hostname.replace(/^www\./, "");
    const seenUrls = new Set();
    const seenSnippets = new Set();
    const results = [];
    const analysisTrace = [];
    const maxItems = Math.max(1, Math.min(30, Number(aiSettings.policy.maxItemsPerSource ?? 12)));
    let agentSteps = 0;
    let refinements = 0;
    let stopRequested = false;
    let pendingRefine = "";
    let anchorCount = 0;
    for (let screen = 0; screen < 3 && analysisTrace.length < maxItems && agentSteps < aiSettings.policy.maxStepsPerSource; screen += 1) {
      const batch = await page.locator("a[href]").evaluateAll((elements, screenIndex) => elements.map((element, index) => {
        const anchor = element;
        const container = anchor.closest("article, li, [role='listitem'], .pbw, [class*='note-item'], [class*='search-result'], [class*='feed-card']") || anchor;
        const snippet = String(container?.innerText || anchor.innerText || "").replace(/\s+/g, " ").trim();
        const marker = `xt-${screenIndex}-${index}`;
        anchor.setAttribute("data-xintan-candidate", marker);
        return { marker, url: anchor.href, title: String(anchor.innerText || "").replace(/\s+/g, " ").trim(), snippet };
      }), screen).catch(() => []);
      anchorCount = Math.max(anchorCount, batch.length);
      const candidates = batch.filter((item) => {
        try {
          const parsed = new URL(item.url);
          const snippetKey = item.snippet.replace(/\s+/g, " ").trim().slice(0, 240);
          const boilerplate = /Powered by Discuz|ICP备|document\.createElement\(["']script|关于我们.*举报/i.test(item.snippet);
          return parsed.hostname.replace(/^www\./, "").endsWith(expectedHost) && isContentUrl(job.platform, parsed) && !boilerplate
            && item.snippet.length >= 12 && item.snippet.length <= 800 && !seenUrls.has(parsed.toString()) && !seenSnippets.has(snippetKey);
        } catch { return false; }
      }).slice(0, Math.max(0, maxItems - analysisTrace.length));
      for (const candidate of candidates) {
        const parsed = new URL(candidate.url);
        seenUrls.add(parsed.toString());
        seenSnippets.add(candidate.snippet.replace(/\s+/g, " ").trim().slice(0, 240));
        const item = { ...candidate, platform: job.platform, snippet: candidate.snippet.slice(0, 800) };
        const position = analysisTrace.length + 1;
        const projectedTotal = Math.min(maxItems, analysisTrace.length + candidates.length);
        const pendingTrace = { index: position, url: parsed.toString(), snippet: item.snippet, author: candidate.title.slice(0, 60) || "公开用户", status: "thinking", decision: "待判断", reason: "AI中枢正在评价内容并选择下一步", tags: [], matchedKeywords: [], intent: "无", intelligenceType: "待判断", score: 0, priority: "C", nextAction: "thinking", actionReason: "", confidence: 0, policyStatus: "checking", model: aiSettings.model };
        searchJobs.set(job.jobId, {
          ...job, status: "running", phase: "thinking", progress: Math.min(88, 28 + position * 5), fetched: results.length,
          inspected: position, kept: results.length, filtered: analysisTrace.filter((entry) => entry.decision === "过滤").length,
          currentAction: `AI中枢正在思考第 ${position} 条的价值与下一步动作`,
          currentItem: pendingTrace, analysisTrace: [...analysisTrace, pendingTrace],
        });
        await showItemAnalysis(page, item, { decision: "思考中", priority: "-", score: 0, reason: "AI中枢正在读取任务目标、原文和安全策略", keep: true }, position, projectedTotal, "reading");
        let brainDecision = await askAiBrain({
          task: { name: job.taskName ?? "猎头情报任务", techKeywords: job.techKeywords, companyKeywords: job.companyKeywords, signalKeywords: job.signalKeywords, excludeKeywords: job.excludeKeywords, timeRange: job.timeRange },
          platform: job.platform, pageUrl: page.url(), candidate: { author: pendingTrace.author, snippet: item.snippet, url: item.url },
          progress: { item: position, inspected: analysisTrace.length, kept: results.length },
          safeActions: ["keep", "filter", "open_source", "read_comments", "refine_search", "scroll_next", "cross_check", "stop"],
        });
        agentSteps += 1;
        let policy = enforceAgentPolicy(brainDecision, job, item);
        let executedAction = policy.action;
        if (policy.allowed && ["open_source", "read_comments"].includes(policy.action) && agentSteps < aiSettings.policy.maxStepsPerSource) {
          searchJobs.set(job.jobId, { ...job, status: "running", phase: "acting", progress: Math.min(90, 29 + position * 5), fetched: results.length, inspected: position, kept: results.length, filtered: analysisTrace.length - results.length, currentAction: `AI决定${policy.action === "read_comments" ? "打开原文并读取公开评论" : "打开原文补充证据"}：${brainDecision.actionReason}`, currentItem: { ...pendingTrace, reasoningSummary: brainDecision.reasoningSummary, nextAction: policy.action, actionReason: brainDecision.actionReason, policyStatus: policy.reason }, analysisTrace: [...analysisTrace] });
          const searchPageUrl = page.url();
          await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
          await page.waitForTimeout(1200);
          const detailText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
          brainDecision = await askAiBrain({
            task: { name: job.taskName ?? "猎头情报任务", techKeywords: job.techKeywords, companyKeywords: job.companyKeywords, signalKeywords: job.signalKeywords, excludeKeywords: job.excludeKeywords },
            platform: job.platform, candidate: { author: pendingTrace.author, snippet: item.snippet, url: item.url },
            toolResult: { action: policy.action, visibleDetail: detailText.replace(/\s+/g, " ").slice(0, 3500) },
            instruction: "根据补充证据给出最终保留或过滤决定，并选择安全的下一步。",
          });
          agentSteps += 1;
          policy = enforceAgentPolicy(brainDecision, job, item);
          executedAction = `${executedAction} → ${policy.action}`;
          await page.goto(searchPageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
          await page.waitForTimeout(700);
        }
        const keep = brainDecision.decision === "keep";
        const exploring = brainDecision.decision === "needs_more" && ["refine_search", "cross_check", "scroll_next"].includes(policy.action);
        const analysis = {
          keep, decision: keep ? "保留" : exploring ? "继续探索" : "过滤", reason: brainDecision.reasoningSummary,
          tags: brainDecision.tags, matchedKeywords: brainDecision.matchedKeywords, intent: brainDecision.intent,
          intelligenceType: brainDecision.intelligenceType, score: brainDecision.score, priority: brainDecision.priority,
          reasoningSummary: brainDecision.reasoningSummary, nextAction: executedAction, actionReason: brainDecision.actionReason,
          confidence: brainDecision.confidence, stopReason: brainDecision.stopReason, policyStatus: policy.reason,
          model: brainDecision.model, responseId: brainDecision.responseId,
        };
        const finishedTrace = { ...pendingTrace, ...analysis, status: "completed" };
        analysisTrace.push(finishedTrace);
        if (analysis.keep) {
          results.push({
            source: job.platform, externalId: parsed.toString(), url: parsed.toString(),
            author: candidate.title.slice(0, 60) || "公开用户", authorId: "", publishedAt: "未公开", snippet: item.snippet,
          });
        }
        searchJobs.set(job.jobId, {
          ...job, status: "running", phase: "analyzing", progress: Math.min(92, 30 + position * 5), fetched: results.length,
          inspected: analysisTrace.length, kept: results.length, filtered: analysisTrace.length - results.length,
          currentAction: `AI完成第 ${position} 条：${analysis.keep ? `保留为${analysis.priority}级${analysis.intelligenceType}` : `过滤`}; 下一步 ${analysis.nextAction}`,
          currentItem: finishedTrace, analysisTrace: [...analysisTrace],
        });
        await showItemAnalysis(page, item, analysis, position, projectedTotal, "decided");
        await page.waitForTimeout(550);
        if (policy.allowed && policy.action === "refine_search" && brainDecision.searchQuery && refinements < 2) {
          pendingRefine = String(brainDecision.searchQuery).slice(0, 160);
          refinements += 1;
          searchJobs.set(job.jobId, { ...job, status: "running", phase: "acting", progress: Math.min(92, 32 + position * 5), fetched: results.length, inspected: analysisTrace.length, kept: results.length, filtered: analysisTrace.length - results.length, currentAction: `AI决定调整检索词：${pendingRefine}；原因：${brainDecision.actionReason}`, currentItem: finishedTrace, analysisTrace: [...analysisTrace] });
          break;
        }
        if (policy.action === "stop") { stopRequested = true; break; }
      }
      if (stopRequested || analysisTrace.length >= maxItems || agentSteps >= aiSettings.policy.maxStepsPerSource) break;
      if (pendingRefine) {
        const refinedUrl = searchUrl(job.platform, [pendingRefine]);
        await page.goto(refinedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
        await prepareSearchPage(page, job.platform, [pendingRefine]);
        await page.waitForTimeout(1600);
        pendingRefine = "";
        continue;
      }
      searchJobs.set(job.jobId, { ...job, status: "running", phase: "loading_more", progress: Math.min(86, 35 + analysisTrace.length * 4), fetched: results.length, inspected: analysisTrace.length, kept: results.length, filtered: analysisTrace.length - results.length, currentAction: `当前屏内容已分析，向下加载更多结果`, analysisTrace: [...analysisTrace] });
      await page.mouse.wheel(0, Math.max(650, await page.evaluate(() => window.innerHeight * 0.78).catch(() => 700))).catch(() => undefined);
      await page.waitForTimeout(1100);
    }
    const title = await page.title().catch(() => "");
    const needsLogin = /登录|sign in|login/i.test(`${title} ${page.url()}`) && results.length === 0;
    searchJobs.set(job.jobId, {
      ...job, status: needsLogin ? "waiting_login" : "completed", phase: needsLogin ? "waiting_login" : "completed", progress: 100,
      fetched: results.length, inspected: analysisTrace.length, kept: results.length, filtered: analysisTrace.length - results.length, results, analysisTrace,
      currentItem: analysisTrace.at(-1),
      currentAction: needsLogin ? `${job.platform}需要登录后继续` : `${job.platform}分析完成：检查 ${analysisTrace.length} 条，保留 ${results.length} 条，过滤 ${analysisTrace.length - results.length} 条`,
      diagnostic: results.length ? undefined : { pageUrl: page.url(), pageTitle: title, anchorCount },
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const current = searchJobs.get(job.jobId) ?? job;
    const failureMessage = error instanceof Error ? error.message : String(error);
    const isAiFailure = /AI中枢|模型服务|Responses API|API Key|结构化决策/i.test(failureMessage);
    searchJobs.set(job.jobId, {
      ...current, status: "failed", phase: "failed", progress: 100, results: [],
      currentAction: failureMessage.includes("ProcessSingleton")
        ? "芯探专用浏览器正在被旧进程占用，请关闭旧窗口后重试"
        : isAiFailure
          ? `AI中枢调用失败：${failureMessage.slice(0, 180)}`
          : "页面加载或采集失败，请在专用浏览器中检查页面",
      completedAt: new Date().toISOString(),
    });
  }
}

async function probeSource(name, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const result = await fetch(target, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36" },
    });
    const restricted = result.status >= 400;
    return { name, reachable: true, status: restricted ? "restricted" : "connected", httpStatus: result.status, checkedAt: new Date().toISOString(), detail: restricted ? "站点可达，需要浏览器会话" : "网络连接正常" };
  } catch (error) {
    return { name, reachable: false, status: "offline", httpStatus: 0, checkedAt: new Date().toISOString(), detail: error?.name === "AbortError" ? "连接超时" : "无法连接站点" };
  } finally {
    clearTimeout(timer);
  }
}

function allowBrowser(request, response) {
  const origin = request.headers.origin;
  if (origin && SITE_ORIGINS.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  allowBrowser(request, response);
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, {
      ok: true,
      name: "芯探电脑助手",
      version: "0.7.1",
      operatorWindow: "direct",
      capabilities: ["open_platform", "direct_operator_window", "browser_sessions", "search_tasks", "central_ai_brain", "policy_guard", "agent_loop", "per_item_analysis", "analysis_audit", "source_verifications"],
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/ai-settings") {
    return json(response, 200, publicAiSettings());
  }
  if (request.method === "POST" && url.pathname === "/v1/ai-settings") {
    try {
      const payload = await readJson(request);
      const parsedBase = new URL(String(payload.baseUrl ?? aiSettings.baseUrl));
      const loopback = ["localhost", "127.0.0.1"].includes(parsedBase.hostname);
      if (parsedBase.protocol !== "https:" && !loopback) return json(response, 400, { error: "AI服务地址必须使用HTTPS（本机调试地址除外）" });
      const incomingPolicy = payload.policy && typeof payload.policy === "object" ? payload.policy : {};
      aiSettings = {
        ...aiSettings, provider: String(payload.provider ?? "openai").slice(0, 40), baseUrl: parsedBase.toString().replace(/\/$/, ""),
        model: String(payload.model ?? aiSettings.model).trim().slice(0, 120), apiKey: String(payload.apiKey ?? "").trim() || aiSettings.apiKey,
        status: "untested", lastError: "",
        policy: {
          maxStepsPerSource: Math.max(4, Math.min(60, Number(incomingPolicy.maxStepsPerSource ?? aiSettings.policy.maxStepsPerSource))),
          maxItemsPerSource: Math.max(1, Math.min(30, Number(incomingPolicy.maxItemsPerSource ?? aiSettings.policy.maxItemsPerSource))),
          allowOpenDetail: incomingPolicy.allowOpenDetail !== false, allowReadComments: incomingPolicy.allowReadComments !== false,
          allowRefineSearch: incomingPolicy.allowRefineSearch !== false, allowCrossPlatformSuggestion: incomingPolicy.allowCrossPlatformSuggestion !== false,
        },
      };
      if (!aiSettings.model || !aiSettings.apiKey) return json(response, 400, { error: "请填写模型名称和API Key" });
      saveAiSettings();
      return json(response, 200, { ok: true, ...publicAiSettings() });
    } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : "AI中枢配置格式不正确" }); }
  }
  if (request.method === "POST" && url.pathname === "/v1/ai-settings/test") {
    try {
      if (!aiSettings.apiKey) return json(response, 400, { error: "请先保存API Key" });
      aiSettings.status = "connected";
      const decision = await askAiBrain({ test: true, task: { name: "连接测试", techKeywords: ["UVM"] }, platform: "测试环境", candidate: { snippet: "熟悉UVM验证，近期考虑新的芯片设计机会。", url: "https://example.com/public" }, safeActions: ["keep", "filter", "stop"] });
      aiSettings.status = "connected"; aiSettings.lastTestAt = new Date().toISOString(); aiSettings.lastError = ""; saveAiSettings();
      return json(response, 200, { ok: true, model: decision.model, sampleDecision: decision.decision, ...publicAiSettings() });
    } catch (error) {
      aiSettings.status = "failed"; aiSettings.lastTestAt = new Date().toISOString(); aiSettings.lastError = error instanceof Error ? error.message : "AI连接测试失败"; saveAiSettings();
      return json(response, 422, { error: aiSettings.lastError, ...publicAiSettings() });
    }
  }
  if (request.method === "GET" && url.pathname === "/v1/browser-sessions") {
    return json(response, 200, { sessions: SOCIAL_PLATFORMS.map((platform) => ({ platform, ...sessionStates[platform], profileName: "芯探专用浏览器" })) });
  }
  if (request.method === "GET" && url.pathname === "/v1/source-verifications") {
    return json(response, 200, { verifications: Object.values(verificationStates) });
  }
  if (request.method === "GET" && url.pathname === "/v1/connectivity") {
    const sources = await Promise.all(Object.entries(PLATFORM_URLS).map(([name, target]) => probeSource(name, target)));
    return json(response, 200, { checkedAt: new Date().toISOString(), sources });
  }
  if (request.method === "POST" && url.pathname === "/v1/operator-window/open") {
    try {
      const page = await openControlledPage(PLATFORM_URLS["知乎"]);
      return json(response, 200, { ok: true, pageUrl: page.url(), message: "已打开芯探操作窗口" });
    } catch { return json(response, 500, { error: "无法打开芯探操作窗口" }); }
  }
  if (request.method === "POST" && url.pathname === "/v1/browser-sessions/open") {
    try {
      const { platform } = await readJson(request);
      const target = PLATFORM_URLS[String(platform)];
      if (!target) return json(response, 400, { error: "暂不支持该平台" });
      void openControlledPage(target).catch(() => undefined);
      if (SOCIAL_PLATFORMS.includes(String(platform))) {
        sessionStates[String(platform)] = { status: "browser_open", lastCheckedAt: new Date().toISOString() };
        saveSessions();
      }
      return json(response, 200, { ok: true, message: `已在芯探专用浏览器打开${platform}` });
    } catch {
      return json(response, 500, { error: "无法启动芯探专用浏览器" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/browser-sessions/confirm") {
    try {
      const { platform } = await readJson(request);
      if (!SOCIAL_PLATFORMS.includes(String(platform))) return json(response, 400, { error: "该来源不需要登录确认" });
      sessionStates[String(platform)] = { status: "logged_in", lastCheckedAt: new Date().toISOString() };
      saveSessions();
      return json(response, 200, { ok: true, message: `${platform}已确认登录` });
    } catch {
      return json(response, 400, { error: "请求格式不正确" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/source-verifications") {
    try {
      const { platform } = await readJson(request);
      if (!PLATFORM_URLS[String(platform)]) return json(response, 400, { error: "暂不支持该平台" });
      const verification = await verifyPlatform(String(platform));
      return json(response, verification.status === "passed" ? 200 : 422, { verification });
    } catch {
      return json(response, 400, { error: "功能验收请求格式不正确" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/search-tasks") {
    try {
      if (aiSettings.status !== "connected" || !aiSettings.apiKey) return json(response, 409, { error: "请先在AI中枢配置模型并通过连接测试" });
      const payload = await readJson(request);
      const platform = String(payload.platform ?? "");
      const target = PLATFORM_URLS[platform];
      if (!target) return json(response, 400, { error: "暂不支持该平台" });
      const jobId = String(payload.jobId ?? `local-${Date.now()}`);
      const queries = Array.isArray(payload.queries) ? payload.queries.map(String) : [];
      const destination = searchUrl(platform, queries);
      const needsLogin = SOCIAL_PLATFORMS.includes(platform) && sessionStates[platform]?.status !== "logged_in";
      const job = {
        jobId, platform, status: needsLogin ? "waiting_login" : "running", progress: 10,
        currentAction: needsLogin ? `已打开${platform}，等待你完成登录` : `已在${platform}打开关键词检索`,
        liveViewUrl: "", searchUrl: destination, createdAt: new Date().toISOString(),
        taskName: String(payload.taskName ?? "猎头情报任务"), timeRange: String(payload.timeRange ?? "近30天"), queries,
        techKeywords: Array.isArray(payload.techKeywords) ? payload.techKeywords.map(String) : queries,
        companyKeywords: Array.isArray(payload.companyKeywords) ? payload.companyKeywords.map(String) : [],
        signalKeywords: Array.isArray(payload.signalKeywords) ? payload.signalKeywords.map(String) : [],
        excludeKeywords: Array.isArray(payload.excludeKeywords) ? payload.excludeKeywords.map(String) : [],
        phase: needsLogin ? "waiting_login" : "searching", inspected: 0, kept: 0, filtered: 0, analysisTrace: [],
      };
      searchJobs.set(jobId, job);
      operationQueue = operationQueue.then(() => processSearchJob(job, queries));
      void operationQueue;
      return json(response, 202, job);
    } catch {
      return json(response, 400, { error: "任务格式不正确" });
    }
  }
  const jobMatch = url.pathname.match(/^\/v1\/search-tasks\/([^/]+)$/);
  if (request.method === "GET" && jobMatch) {
    const job = searchJobs.get(decodeURIComponent(jobMatch[1]));
    return job ? json(response, 200, job) : json(response, 404, { error: "任务不存在" });
  }
  const cancelMatch = url.pathname.match(/^\/v1\/search-tasks\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) {
    const jobId = decodeURIComponent(cancelMatch[1]);
    const job = searchJobs.get(jobId);
    if (job) searchJobs.set(jobId, { ...job, status: "cancelled", currentAction: "任务已取消" });
    return json(response, 200, { ok: true });
  }
  return json(response, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`芯探电脑助手已启动：http://${HOST}:${PORT}\n关闭此窗口会停止电脑连接。\n`);
});

async function shutdown() {
  await browserContext?.close().catch(() => undefined);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
