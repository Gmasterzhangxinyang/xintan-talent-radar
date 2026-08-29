import http from "node:http";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";
import { detectBrowserExecutable, platformLabel } from "./platform.mjs";
import { isZhihuContentUrl, parseVisibleDate } from "./zhihu-utils.mjs";

const HOST = "127.0.0.1";
const PORT = 8765;
const APP_BASE_URL = String(process.env.XINTAN_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_ORIGINS = new Set([
  "https://xintan-talent-radar.iyihioh.chatgpt.site",
  "http://localhost:3000",
  "http://localhost:5173",
]);
const PLATFORM_URLS = {
  "知乎": "https://www.zhihu.com/",
};
const SOCIAL_PLATFORMS = ["知乎"];
const searchJobs = new Map();
const verificationQueries = ["芯片", "设计"];
let operationQueue = Promise.resolve();
const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_FILE = resolve(PROJECT_DIR, "work", "local-assistant-sessions.json");
const AI_SETTINGS_FILE = resolve(PROJECT_DIR, "work", "ai-brain-settings.json");
const BROWSER_PROFILE_DIR = resolve(PROJECT_DIR, "work", "browser-profile");
const BROWSER_EXECUTABLE = detectBrowserExecutable();
const OPERATING_SYSTEM = platformLabel();
const ASSISTANT_STARTED_AT = new Date().toISOString();
const ASSISTANT_VERSION = "1.1.0-zhihu";
mkdirSync(resolve(PROJECT_DIR, "work"), { recursive: true });
let sessionStates = Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform, { status: "unknown", lastCheckedAt: new Date().toISOString() }]));
let verificationStates = {};
const DEFAULT_AI_SETTINGS = {
  provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", apiKey: "",
  status: "not_configured", lastTestAt: "", lastError: "",
  policy: {
    maxStepsPerSource: 24, maxItemsPerSource: 12, allowOpenDetail: true, allowReadComments: true,
    allowRefineSearch: true, allowCrossPlatformSuggestion: false,
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
let browserContext;
let browserConnection;
let operatorPage;
let schedulerRunning = false;
let schedulerLastRunAt = "";
let schedulerLastError = "";

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function saveSessions() {
  writeFileSync(SESSION_FILE, JSON.stringify({ profile: "xintan-dedicated-v1", sessions: sessionStates, verifications: verificationStates }, null, 2));
}

function publicAiSettings() {
  return {
    provider: aiSettings.provider, baseUrl: aiSettings.baseUrl, model: aiSettings.model,
    hasApiKey: Boolean(aiSettings.apiKey), status: aiSettings.status, lastTestAt: aiSettings.lastTestAt,
    lastError: aiSettings.lastError, policy: aiSettings.policy,
    allowedActions: ["检索", "滚动", "读取公开内容", "打开知乎原文", "读取公开评论", "调整关键词", "返回"],
    blockedActions: ["私信", "评论或发布", "点赞关注", "上传下载", "输入密码或验证码", "绕过人机验证", "访问非白名单域名"],
  };
}

function saveAiSettings() {
  writeFileSync(AI_SETTINGS_FILE, JSON.stringify(aiSettings, null, 2));
  chmodSync(AI_SETTINGS_FILE, 0o600);
}

function buildSearchJob(payload) {
  const platform = "知乎";
  const jobId = String(payload.jobId ?? `local-${Date.now()}`);
  const queries = Array.isArray(payload.queries) ? payload.queries.map(String) : [];
  const needsLogin = sessionStates[platform]?.status !== "logged_in";
  return {
    jobId, platform, status: needsLogin ? "waiting_login" : "running", progress: 10,
    currentAction: needsLogin ? "已打开知乎，等待你完成登录" : "已在知乎打开关键词检索",
    liveViewUrl: "", searchUrl: searchUrl(platform, queries), createdAt: new Date().toISOString(),
    triggerMode: String(payload.triggerMode ?? "manual") === "background" ? "background" : "manual",
    taskName: String(payload.taskName ?? "猎头情报任务"), timeRange: String(payload.timeRange ?? "近30天"), queries,
    targetItems: Math.max(1, Math.min(50, Number(payload.targetItems ?? 10))), commentTarget: Math.max(1, Math.min(50, Number(payload.commentTarget ?? 20))),
    itemsPerQuery: Math.max(1, Math.min(2, Number(payload.itemsPerQuery ?? 2))),
    techKeywords: Array.isArray(payload.techKeywords) ? payload.techKeywords.map(String) : queries,
    companyKeywords: Array.isArray(payload.companyKeywords) ? payload.companyKeywords.map(String) : [],
    signalKeywords: Array.isArray(payload.signalKeywords) ? payload.signalKeywords.map(String) : [],
    excludeKeywords: Array.isArray(payload.excludeKeywords) ? payload.excludeKeywords.map(String) : [],
    authorBlacklist: Array.isArray(payload.authorBlacklist) ? payload.authorBlacklist.map(String) : [],
    companyBlacklist: Array.isArray(payload.companyBlacklist) ? payload.companyBlacklist.map(String) : [],
    phase: needsLogin ? "waiting_login" : "searching", inspected: 0, kept: 0, filtered: 0, analysisTrace: [],
  };
}

async function runDueTasks({ force = false, taskId = "" } = {}) {
  if (schedulerRunning) return { ok: false, status: "busy", message: "后台扫描正在运行" };
  schedulerRunning = true;
  schedulerLastError = "";
  try {
    const stateResponse = await fetch(`${APP_BASE_URL}/api/state`, { signal: AbortSignal.timeout(15_000) });
    if (!stateResponse.ok) throw new Error(`读取任务失败：HTTP ${stateResponse.status}`);
    const state = await stateResponse.json();
    const now = Date.now();
    const tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter((task) => {
      if (taskId && task.id !== taskId) return false;
      if (task.status !== "active" || !Array.isArray(task.sources) || !task.sources.includes("知乎")) return false;
      if (!force && task.scheduleEnabled === false) return false;
      if (force) return true;
      const next = Date.parse(String(task.nextRunAt ?? ""));
      return Number.isFinite(next) && next <= now;
    });
    const completed = [];
    for (const task of tasks.slice(0, force ? 1 : 3)) {
      const job = buildSearchJob({
        jobId: `scheduled-${task.id}-${Date.now()}`, triggerMode: "background", taskName: task.name,
        queries: [...(task.techKeywords ?? []), ...(task.companyKeywords ?? []), ...(task.signalKeywords ?? [])],
        techKeywords: task.techKeywords, companyKeywords: task.companyKeywords, signalKeywords: task.signalKeywords,
        excludeKeywords: task.excludeKeywords, authorBlacklist: task.authorBlacklist, companyBlacklist: task.companyBlacklist,
        timeRange: task.timeRange, targetItems: Number(task.sourceLimits?.知乎 ?? 10), commentTarget: 20,
      });
      if (job.status === "waiting_login") {
        completed.push({ taskId: task.id, status: "waiting_login" });
        continue;
      }
      searchJobs.set(job.jobId, job);
      operationQueue = operationQueue.then(() => processSearchJob(job, job.queries));
      await operationQueue;
      const result = searchJobs.get(job.jobId) ?? job;
      const callback = await fetch(`${APP_BASE_URL}/api/state`, {
        method: "POST", signal: AbortSignal.timeout(30_000), headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "runTask", taskId: task.id, localJobs: { 知乎: result }, localCandidates: result.results ?? [] }),
      });
      if (!callback.ok) throw new Error(`写入扫描结果失败：HTTP ${callback.status}`);
      completed.push({ taskId: task.id, jobId: job.jobId, status: result.status, inspected: result.inspected ?? 0, kept: result.kept ?? 0 });
    }
    schedulerLastRunAt = new Date().toISOString();
    return { ok: true, status: "completed", checked: tasks.length, completed };
  } catch (error) {
    schedulerLastError = error instanceof Error ? error.message : String(error);
    return { ok: false, status: "failed", error: schedulerLastError };
  } finally {
    schedulerRunning = false;
  }
}

const AI_DECISION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["keep", "filter", "needs_more"] },
    contentType: { type: "string", enum: ["talent", "company_intelligence", "both", "industry_discussion", "recruitment_ad", "marketing", "irrelevant", "uncertain"] },
    reasoningSummary: { type: "string" },
    nextAction: { type: "string", enum: ["keep", "filter", "open_source", "read_comments", "refine_search", "scroll_next", "cross_check", "stop"] },
    actionReason: { type: "string" }, searchQuery: { type: "string" }, crossCheckPlatform: { type: "string" },
    tags: { type: "array", items: { type: "string" }, maxItems: 8 },
    matchedKeywords: { type: "array", items: { type: "string" }, maxItems: 10 },
    evidenceQuotes: { type: "array", items: { type: "string" }, maxItems: 5 },
    intent: { type: "string", enum: ["强", "中", "无"] },
    intelligenceType: { type: "string", enum: ["人才线索", "企业情报", "无效内容"] },
    companyIntelligenceType: { type: "string", enum: ["layoff", "hiring_expansion", "project_change", "tapeout_issue", "team_change", "business_change", "unknown"] },
    jobMatchScore: { type: "integer", minimum: 0, maximum: 100 },
    intentScore: { type: "integer", minimum: 0, maximum: 100 },
    companyIntelScore: { type: "integer", minimum: 0, maximum: 100 },
    identityConfidence: { type: "number", minimum: 0, maximum: 1 },
    evidenceConfidence: { type: "number", minimum: 0, maximum: 1 },
    uncertainty: { type: "array", items: { type: "string" }, maxItems: 6 },
    recommendedAction: { type: "string", enum: ["human_review", "follow_up", "monitor", "ignore"] },
    score: { type: "integer", minimum: 0, maximum: 100 }, priority: { type: "string", enum: ["A", "B", "C"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }, stopReason: { type: "string" },
  },
  required: ["decision", "contentType", "reasoningSummary", "nextAction", "actionReason", "searchQuery", "crossCheckPlatform", "tags", "matchedKeywords", "evidenceQuotes", "intent", "intelligenceType", "companyIntelligenceType", "jobMatchScore", "intentScore", "companyIntelScore", "identityConfidence", "evidenceConfidence", "uncertainty", "recommendedAction", "score", "priority", "confidence", "stopReason"],
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
  const visualFrames = Array.isArray(observation.visualFrames) ? observation.visualFrames.slice(0, 2) : [];
  const textObservation = { ...observation };
  delete textObservation.visualFrames;
  const inputContent = [{ type: "input_text", text: JSON.stringify(textObservation) }, ...visualFrames.map((imageUrl) => ({ type: "input_image", image_url: imageUrl }))];
  const response = await fetch(endpoint, {
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiSettings.apiKey}` },
    body: JSON.stringify({
      model: aiSettings.model, store: false, max_output_tokens: 900,
      instructions: `你是芯片设计行业猎头情报Agent的中央决策大脑。只分析公开或已授权内容。每个候选都已经由电脑Agent打开站内详情并读取可见正文与公开评论，你必须基于详情证据判断，不能只复述列表摘要。分别评价岗位匹配、求职意向、企业事件、公开身份可信度和证据充分度；内容可能同时包含人才与企业情报。evidenceQuotes应给出1至5条简短原文证据且必须逐字存在于输入内容；强求职意向与企业事件没有证据时必须降为uncertain。不要根据昵称、头像或地域推断敏感属性。你只能从给定的安全动作中选择下一步，绝不能私信、发布、点赞、关注、上传、下载、输入密码/验证码、绕过验证或离开平台白名单域名。输出简短可审计的决策摘要，不输出隐藏思维链。`,
      input: [{ role: "user", content: inputContent }],
      text: { format: { type: "json_schema", name: "talent_agent_decision", strict: true, schema: AI_DECISION_SCHEMA } },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? `AI服务返回 ${response.status}`);
  const output = responseOutputText(payload);
  if (!output) throw new Error("AI中枢没有返回结构化决策");
  return { ...JSON.parse(output), model: payload.model ?? aiSettings.model, responseId: payload.id ?? "" };
}

async function askAiBrainWithRetry(observation) {
  let lastError;
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decision = await askAiBrain(attempt === 0 ? observation : { ...observation, visualFrames: [] });
      return { ...decision, latencyMs: Date.now() - startedAt, retryCount: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolveRetry) => setTimeout(resolveRetry, 700));
    }
  }
  throw lastError;
}

async function analyzeImportedItems(items, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index] && typeof items[index] === "object" ? items[index] : {};
      try {
        const decision = await askAiBrainWithRetry({
          importMode: true,
          task: {
            name: String(task?.name ?? "导入分析"), techKeywords: Array.isArray(task?.techKeywords) ? task.techKeywords : [],
            companyKeywords: Array.isArray(task?.companyKeywords) ? task.companyKeywords : [],
            signalKeywords: Array.isArray(task?.signalKeywords) ? task.signalKeywords : [],
          },
          platform: String(item.source ?? "导入"), pageUrl: String(item.url ?? ""),
          candidate: { author: String(item.author ?? ""), publishedAt: String(item.publishedAt ?? ""), snippet: String(item.fullText ?? item.snippet ?? ""), url: String(item.url ?? "") },
          safeActions: ["keep", "filter", "stop"],
          instruction: "这是用户主动导入的公开内容。只做结构化分析，不执行浏览器操作；证据必须逐字来自输入原文。",
        });
        results[index] = decision.decision === "keep" ? {
          status: "accepted",
          item: { ...item, raw: { ...(item.raw && typeof item.raw === "object" ? item.raw : {}), aiAnalysis: {
            tags: decision.tags, intent: decision.intent, intelligenceType: decision.intelligenceType,
            contentType: decision.contentType, companyIntelligenceType: decision.companyIntelligenceType,
            jobMatchScore: decision.jobMatchScore, intentScore: decision.intentScore, companyIntelScore: decision.companyIntelScore,
            identityConfidence: decision.identityConfidence, evidenceConfidence: decision.evidenceConfidence,
            uncertainty: decision.uncertainty, recommendedAction: decision.recommendedAction,
            score: decision.score, reasoningSummary: decision.reasoningSummary, companyNote: decision.reasoningSummary,
            evidenceQuotes: decision.evidenceQuotes, confidence: decision.confidence, model: decision.model, responseId: decision.responseId,
            latencyMs: decision.latencyMs, retryCount: decision.retryCount,
          } } },
        } : { status: "filtered", reason: decision.reasoningSummary };
      } catch (error) {
        results[index] = { status: "failed", reason: error instanceof Error ? error.message : "AI分析失败" };
      }
    }
  }
  await Promise.all([worker(), worker()]);
  return results;
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
  if (browserContext) {
    try {
      browserContext.pages();
      return browserContext;
    } catch {
      browserContext = undefined;
      operatorPage = undefined;
    }
  }
  try {
    browserConnection = await chromium.connectOverCDP("http://127.0.0.1:9222");
    browserContext = browserConnection.contexts()[0];
    if (browserContext) {
      browserConnection.on("disconnected", () => { browserConnection = undefined; browserContext = undefined; });
      return browserContext;
    }
  } catch { /* start a dedicated browser below */ }
  browserContext = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    ...(BROWSER_EXECUTABLE ? { executablePath: BROWSER_EXECUTABLE } : {}),
    headless: false,
    viewport: null,
    args: ["--window-size=760,620", "--window-position=80,70", "--remote-debugging-port=9222", "--disable-blink-features=AutomationControlled"],
  });
  browserContext.on("close", () => { browserContext = undefined; operatorPage = undefined; });
  return browserContext;
}

async function openControlledPage(target) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const context = await ensureBrowser();
      const page = operatorPage && !operatorPage.isClosed() ? operatorPage : await context.newPage();
      operatorPage = page;
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (page.isClosed()) throw new Error("操作窗口已关闭");
      try {
        const session = await context.newCDPSession(page);
        const { windowId } = await session.send("Browser.getWindowForTarget");
        await session.send("Browser.setWindowBounds", { windowId, bounds: { left: 80, top: 70, width: 760, height: 620, windowState: "normal" } });
        await session.detach();
      } catch { /* window is still usable when resizing is unavailable */ }
      await page.bringToFront();
      return page;
    } catch (error) {
      lastError = error;
      operatorPage = undefined;
      await delay(500);
    }
  }
  throw lastError ?? new Error("无法建立知乎操作窗口");
}

function searchUrl(platform, queries) {
  const keyword = queries.filter(Boolean).slice(0, 8).join(" ").trim();
  const encoded = encodeURIComponent(keyword);
  return `https://www.zhihu.com/search?type=content&q=${encoded}&sort_by=created_time`;
}

function buildSearchPlan(job, queries) {
  const clean = (values) => [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))];
  const companies = clean(job.companyKeywords).slice(0, 6);
  const rawSignals = clean(job.signalKeywords).slice(0, 10);
  const eventPattern = /裁员|扩招|团队|项目|流片|回片|离职|跳槽|机会|内推|hc/i;
  const signals = [...rawSignals.filter((signal) => eventPattern.test(signal)), ...rawSignals.filter((signal) => !eventPattern.test(signal))];
  const technologies = clean(job.techKeywords).slice(0, 6);
  const fallbacks = clean(queries).slice(0, 8);
  const now = new Date();
  const rangeDays = Number(String(job.timeRange || "近30天").match(/\d+/)?.[0] ?? 30);
  const freshnessTerm = rangeDays <= 30 ? `${now.getFullYear()}年${now.getMonth() + 1}月` : `${now.getFullYear()}年`;
  const plan = [];
  const seen = new Set();
  const add = (...terms) => {
    const query = clean(terms).slice(0, 3);
    const key = query.join(" ");
    if (!key || seen.has(key)) return;
    seen.add(key);
    plan.push(query);
  };

  companies.forEach((company, index) => add(company, signals[index % Math.max(1, signals.length)] || "团队调整", freshnessTerm));
  signals.slice(0, 4).forEach((signal) => add("芯片", signal, freshnessTerm));
  companies.forEach((company, index) => add(company, signals[index % Math.max(1, signals.length)] || "团队调整"));
  companies.forEach((company, index) => add(company, signals[(index + companies.length) % Math.max(1, signals.length)] || "扩招"));
  signals.forEach((signal) => add("芯片", signal));
  technologies.forEach((technology, index) => add(technology, signals[(index + 2) % Math.max(1, signals.length)] || "看机会"));
  add(...fallbacks.slice(0, 3));
  return plan.slice(0, 18).length ? plan.slice(0, 18) : [["芯片"]];
}

function hardFilterReasons(job, metadata, detailText) {
  const searchable = `${metadata.author || ""} ${detailText}`.toLowerCase();
  const reasons = [];
  const excludeMatches = (job.excludeKeywords ?? []).filter((term) => searchable.includes(String(term).toLowerCase()));
  const authorMatches = (job.authorBlacklist ?? []).filter((term) => String(metadata.author || "").toLowerCase().includes(String(term).toLowerCase()));
  const companyMatches = (job.companyBlacklist ?? []).filter((term) => searchable.includes(String(term).toLowerCase()));
  if (excludeMatches.length) reasons.push(`命中内容黑名单：${excludeMatches.join("、")}`);
  if (authorMatches.length) reasons.push(`命中作者黑名单：${authorMatches.join("、")}`);
  if (companyMatches.length) reasons.push(`命中企业黑名单：${companyMatches.join("、")}`);
  const publishedDate = parseVisibleDate(metadata.publishedAt);
  const rangeDays = Number(String(job.timeRange || "近30天").match(/\d+/)?.[0] ?? 30);
  if (!publishedDate) reasons.push("发布时间不可验证，无法确认满足时间范围");
  else if (publishedDate.getTime() < Date.now() - rangeDays * 86_400_000) reasons.push(`发布时间超出${job.timeRange || "设置范围"}`);
  return { reasons, excludeMatches: [...excludeMatches, ...authorMatches, ...companyMatches] };
}

function isContentUrl(platform, parsed) {
  return platform === "知乎" && isZhihuContentUrl(parsed);
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
  return { performed: platform === "知乎" && queries.length > 0 && page.url().includes("/search"), method: "direct_url" };
}

async function scrollPageVisibly(page, delta = 760) {
  const measure = () => page.evaluate(() => {
    const root = document.scrollingElement;
    const marked = document.querySelector("[data-xintan-scroll-target='1']");
    const rootMax = Math.max(0, (root?.scrollHeight ?? document.documentElement.scrollHeight) - window.innerHeight);
    return {
      windowTop: window.scrollY, rootTop: root?.scrollTop ?? 0, bodyTop: document.body?.scrollTop ?? 0,
      nestedTop: marked?.scrollTop ?? 0, rootMax,
      nestedMax: marked ? Math.max(0, marked.scrollHeight - marked.clientHeight) : 0,
    };
  }).catch(() => ({ windowTop: 0, rootTop: 0, bodyTop: 0, nestedTop: 0, rootMax: 0, nestedMax: 0 }));

  const pointer = await page.evaluate(() => {
    document.querySelectorAll("[data-xintan-scroll-target='1']").forEach((element) => element.removeAttribute("data-xintan-scroll-target"));
    const nested = Array.from(document.querySelectorAll("*"))
      .filter((element) => !["HTML", "BODY"].includes(element.tagName) && element.clientHeight > 120 && element.scrollHeight > element.clientHeight + 40)
      .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))[0];
    if (nested) {
      nested.setAttribute("data-xintan-scroll-target", "1");
      if (nested.scrollTop >= nested.scrollHeight - nested.clientHeight - 8) nested.scrollTop = 0;
    }
    const rect = nested?.getBoundingClientRect();
    return {
      x: rect ? Math.max(24, Math.min(window.innerWidth - 24, rect.left + rect.width / 2)) : window.innerWidth / 2,
      y: rect ? Math.max(24, Math.min(window.innerHeight - 24, rect.top + Math.min(rect.height, window.innerHeight) / 2)) : window.innerHeight / 2,
    };
  }).catch(() => ({ x: 380, y: 310 }));
  const before = await measure();
  await page.mouse.move(pointer.x, pointer.y).catch(() => undefined);
  await page.mouse.wheel(0, delta).catch(() => undefined);
  await delay(450);
  let after = await measure();
  const changed = () => after.windowTop !== before.windowTop || after.rootTop !== before.rootTop || after.bodyTop !== before.bodyTop || after.nestedTop !== before.nestedTop;
  let method = "wheel";
  if (!changed()) {
    method = "smooth_fallback";
    await page.evaluate((amount) => {
      const nested = document.querySelector("[data-xintan-scroll-target='1']");
      if (nested && nested.scrollHeight > nested.clientHeight + 40) nested.scrollBy({ top: amount, behavior: "smooth" });
      else window.scrollBy({ top: amount, behavior: "smooth" });
    }, delta).catch(() => undefined);
    await delay(650);
    after = await measure();
  }
  return { canScroll: before.rootMax > 0 || before.nestedMax > 0, didScroll: changed(), method, before, after };
}

async function verifyPlatform(platform) {
  const startedAt = new Date().toISOString();
  const checks = [];
  const record = (key, label, passed, detail) => checks.push({ key, label, status: passed ? "passed" : "failed", detail });
  try {
    const destination = searchUrl(platform, verificationQueries);
    const page = await openControlledPage(destination);
    const searchAction = await prepareSearchPage(page, platform, verificationQueries);
    await delay(2200);

    let bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const pageTitle = await page.title().catch(() => "");
    const pageUrl = page.url();
    const accessGate = /人机验证|安全验证|访问验证|captcha|challenge/i.test(`${pageTitle} ${bodyText.slice(0, 2000)}`);
    record("page", "网页打开", bodyText.trim().length > 30 && !pageUrl.startsWith("chrome-error://") && !accessGate, accessGate ? "页面进入人机或安全验证" : `${pageTitle || platform} · ${pageUrl}`);

    const loginGate = /(?:passport|login|signin)/i.test(pageUrl) || /请先登录|登录后(?:继续|查看)|扫码登录/.test(bodyText.slice(0, 6000));
    if (SOCIAL_PLATFORMS.includes(platform)) record("account", "账号会话", !loginGate, loginGate ? "页面仍要求登录" : "未发现登录拦截");

    const joinedKeyword = verificationQueries.join(" ");
    const searchDetected = searchAction.performed && pageUrl !== PLATFORM_URLS[platform]
      && (decodeURIComponent(pageUrl).includes(verificationQueries[0]) || bodyText.includes(verificationQueries[0]));
    record("search", "关键词查找", searchDetected, searchDetected ? `已执行“${joinedKeyword}”检索` : "未确认检索结果页");

    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("[data-xintan-scroll-target='1']").forEach((element) => { element.scrollTop = 0; }); }).catch(() => undefined);
    const scrollResult = await scrollPageVisibly(page, 1100);
    record("scroll", "页面滚动", scrollResult.canScroll && scrollResult.didScroll, !scrollResult.canScroll ? "当前页面没有可滚动内容" : scrollResult.didScroll ? `页面已产生滚动位移（${scrollResult.method === "wheel" ? "滚轮" : "平滑滚动"}）` : "页面可滚动，但没有产生位移");

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

async function extractPublicMetadata(page, fallbackAuthor, fallbackPublishedAt = "", fallbackAuthorId = "") {
  const candidates = await page.locator(".AuthorInfo-name, .UserLink-link, [itemprop='author'], [data-e2e*='author'], [class*='AuthorInfo'], a[href*='/people/']").evaluateAll((elements) => elements.map((element) => ({
    text: String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
    href: element instanceof HTMLAnchorElement ? element.href : String(element.closest("a")?.href || ""),
  })).filter((item) => item.text.length >= 2 && item.text.length <= 80).slice(0, 20)).catch(() => []);
  const authorCandidate = candidates.find((candidate) => /\/people\//.test(candidate.href)) ?? candidates[0];
  let authorId = fallbackAuthorId;
  try { authorId = new URL(authorCandidate?.href || "").pathname.split("/").filter(Boolean).at(-1) || ""; } catch { /* not exposed */ }
  const metaDates = await page.locator("meta[itemprop='datePublished'], meta[property='article:published_time'], meta[name='date']").evaluateAll((elements) => elements.map((element) => String(element.getAttribute("content") || "").trim()).filter(Boolean)).catch(() => []);
  const timeTexts = await page.locator("time, [datetime], [data-tooltip*='发布于'], .ContentItem-time, .Post-Header time").evaluateAll((elements) => elements.map((element) => String(element.getAttribute("datetime") || element.getAttribute("data-tooltip") || element.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 20)).catch(() => []);
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const timePattern = /(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2})?|\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2})?|\d+\s*(?:分钟前|小时前|天前))/;
  const publishedAt = metaDates[0] || timeTexts.find((value) => timePattern.test(value))?.match(timePattern)?.[0] || bodyText.match(timePattern)?.[0] || fallbackPublishedAt || "未公开";
  return { author: authorCandidate?.text || fallbackAuthor || "公开用户", authorId, publishedAt };
}

async function extractDetailContent(page) {
  const title = await page.locator("h1.Post-Title, h1.QuestionHeader-title, h1").first().innerText({ timeout: 3000 }).catch(() => "");
  const selectors = [".Post-RichTextContainer", ".QuestionAnswer-content", ".RichContent-inner", ".RichText.ztext", "article"];
  let body = "";
  for (const selector of selectors) {
    const texts = await page.locator(selector).allTextContents().catch(() => []);
    const candidate = texts.map((text) => String(text).replace(/\s+/g, " ").trim()).sort((a, b) => b.length - a.length)[0] || "";
    if (candidate.length > body.length) body = candidate;
    if (body.length >= 300) break;
  }
  if (!body) body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return `${title.trim()}\n${body.trim()}`.replace(/\s+/g, " ").trim().slice(0, 20_000);
}

async function readDetailProgressively(page, { job, position, pendingTrace, results, analysisTrace }) {
  const detailState = await page.evaluate(() => {
    const selectors = [".Post-RichTextContainer", ".QuestionAnswer-content", ".RichContent-inner", ".RichText.ztext", "article"];
    const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const detail = candidates.sort((left, right) => (right.scrollHeight || right.textContent?.length || 0) - (left.scrollHeight || left.textContent?.length || 0))[0];
    if (!detail) return { found: false, steps: 1 };
    detail.setAttribute("data-xintan-detail", "1");
    detail.style.outline = "3px solid #635bff";
    detail.style.outlineOffset = "6px";
    const viewport = Math.max(320, window.innerHeight * 0.62);
    return { found: true, steps: Math.max(1, Math.min(10, Math.ceil(detail.getBoundingClientRect().height / viewport))) };
  }).catch(() => ({ found: false, steps: 1 }));

  for (let step = 0; step < detailState.steps; step += 1) {
    if (page.isClosed()) throw new Error("阅读正文时操作窗口被关闭");
    const current = step + 1;
    await page.locator("[data-xintan-detail='1']").first().evaluate((element, progress) => {
      const rect = element.getBoundingClientRect();
      const start = window.scrollY + rect.top;
      const viewport = Math.max(320, window.innerHeight * 0.62);
      window.scrollTo({ top: Math.max(0, start + (progress - 1) * viewport - 96), behavior: "smooth" });
      let overlay = document.querySelector("#xintan-analysis-overlay");
      if (!overlay) {
        overlay = document.createElement("aside");
        overlay.id = "xintan-analysis-overlay";
        Object.assign(overlay.style, { position: "fixed", top: "18px", right: "18px", zIndex: "2147483647", width: "330px", padding: "16px", borderRadius: "12px", background: "rgba(16,18,24,.96)", color: "white", boxShadow: "0 18px 60px rgba(0,0,0,.34)", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" });
        document.documentElement.appendChild(overlay);
      }
      overlay.textContent = "";
      const heading = document.createElement("strong");
      heading.textContent = "芯探 · 正文深读";
      Object.assign(heading.style, { display: "block", color: "#aaa7ff", fontSize: "13px", marginBottom: "10px" });
      const status = document.createElement("div");
      status.textContent = `正在逐段阅读 ${progress.current}/${progress.total}`;
      Object.assign(status.style, { fontSize: "15px", fontWeight: "700", marginBottom: "8px" });
      const note = document.createElement("p");
      note.textContent = "阅读当前可见段落并提取事实、时间和求职/企业信号";
      Object.assign(note.style, { margin: "0", color: "#d7d9e0", fontSize: "12px", lineHeight: "1.6" });
      overlay.append(heading, status, note);
    }, { current, total: detailState.steps }).catch(() => undefined);
    searchJobs.set(job.jobId, {
      ...job, status: "running", phase: "reading_detail", fetched: results.length,
      inspected: position, kept: results.length, filtered: analysisTrace.length - results.length,
      currentAction: `第 ${position}/${job.targetItems} 条：逐段阅读正文 ${current}/${detailState.steps}`,
      currentItem: { ...pendingTrace, status: "reading_detail", detailRead: current, detailTarget: detailState.steps, reason: "正在逐段滚动阅读正文，尚未形成最终结论" },
      analysisTrace: [...analysisTrace],
    });
    await delay(650);
  }
  return detailState;
}

async function expandZhihuComments(page) {
  const triggers = page.locator("button:has-text('查看全部'), button:has-text('展开评论'), button:has-text('查看评论'), button:has-text('条评论'), a:has-text('查看全部评论')");
  const count = await triggers.count().catch(() => 0);
  for (let index = 0; index < Math.min(3, count); index += 1) {
    const trigger = triggers.nth(index);
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(900);
      break;
    }
  }
}

async function readCommentsProgressively(page, { job, position, target, pendingTrace, results, analysisTrace }) {
  const comments = [];
  const seen = new Set();
  if (job.platform === "知乎") await expandZhihuComments(page);
  for (let round = 0; round < 8 && comments.length < target; round += 1) {
    const commentSelector = job.platform === "知乎"
      ? ".CommentItem, .CommentContent, [class*='CommentItem'], [class*='NestComment']"
      : "[class*='comment'], [id*='comment'], [aria-label*='评论'], [data-e2e*='comment']";
    const visible = await page.locator(commentSelector).evaluateAll((elements, roundIndex) => elements.map((element, index) => {
      const text = String(element.innerText || "").replace(/\s+/g, " ").trim();
      const marker = `xt-comment-${roundIndex}-${index}`;
      element.setAttribute("data-xintan-comment", marker);
      return { marker, text };
    }).filter((item) => item.text.length >= 8), round).catch(() => []);
    let added = 0;
    for (const comment of visible) {
      const key = comment.text.slice(0, 260);
      if (seen.has(key)) continue;
      seen.add(key); comments.push(comment.text.slice(0, 600)); added += 1;
      const currentComment = page.locator(`[data-xintan-comment="${comment.marker}"]`).first();
      await currentComment.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => undefined);
      await currentComment.evaluate((element, progress) => {
        document.querySelectorAll("[data-xintan-comment-active='1']").forEach((active) => {
          active.removeAttribute("data-xintan-comment-active");
          active.style.outline = "";
          active.style.outlineOffset = "";
        });
        element.setAttribute("data-xintan-comment-active", "1");
        element.style.outline = "3px solid #635bff";
        element.style.outlineOffset = "4px";
        let overlay = document.querySelector("#xintan-analysis-overlay");
        if (!overlay) {
          overlay = document.createElement("aside");
          overlay.id = "xintan-analysis-overlay";
          Object.assign(overlay.style, { position: "fixed", top: "18px", right: "18px", zIndex: "2147483647", width: "330px", padding: "16px", borderRadius: "12px", background: "rgba(16,18,24,.96)", color: "white", boxShadow: "0 18px 60px rgba(0,0,0,.34)", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" });
          document.documentElement.appendChild(overlay);
        }
        overlay.textContent = "";
        const heading = document.createElement("strong");
        heading.textContent = "芯探 · 评论深读";
        Object.assign(heading.style, { display: "block", color: "#aaa7ff", fontSize: "13px", marginBottom: "10px" });
        const status = document.createElement("div");
        status.textContent = `正在阅读第 ${progress.index}/${progress.target} 条公开评论`;
        Object.assign(status.style, { fontSize: "15px", fontWeight: "700", marginBottom: "8px" });
        const note = document.createElement("p");
        note.textContent = progress.preview;
        Object.assign(note.style, { margin: "0", color: "#d7d9e0", fontSize: "12px", lineHeight: "1.6" });
        overlay.append(heading, status, note);
      }, { index: comments.length, target, preview: comment.text.slice(0, 180) }).catch(() => undefined);
      searchJobs.set(job.jobId, {
        ...job, status: "running", phase: "reading_comments", fetched: results.length,
        inspected: position, kept: results.length, filtered: analysisTrace.length - results.length,
        currentAction: `第 ${position}/${job.targetItems} 条：逐条阅读公开评论 ${comments.length}/${target}`,
        currentItem: { ...pendingTrace, status: "reading_comments", commentRead: comments.length, commentTarget: target, commentPreview: comment.text.slice(0, 180), reason: "正在逐条阅读评论，尚未形成最终结论" },
        analysisTrace: [...analysisTrace],
      });
      await delay(700);
      if (comments.length >= target) break;
    }
    if (comments.length >= target) break;
    await scrollPageVisibly(page, 520);
    await delay(added ? 750 : 950);
    if (!added && round >= 2) break;
  }
  return comments;
}

async function readRankedZhihuSearchResults(page) {
  return page.evaluate(async () => {
    const resource = performance.getEntriesByType("resource").map((entry) => entry.name).reverse()
      .find((url) => url.includes("/api/v4/search_v3"));
    if (!resource) return [];
    const response = await fetch(resource, { credentials: "include" });
    if (!response.ok) return [];
    const payload = await response.json();
    const strip = (value) => {
      const holder = document.createElement("div");
      holder.innerHTML = String(value || "");
      return String(holder.textContent || "").replace(/\s+/g, " ").trim();
    };
    return (Array.isArray(payload.data) ? payload.data : []).map((entry, index) => {
      const object = entry?.object;
      if (!object || entry.type !== "search_result") return null;
      let url = "";
      if (object.type === "article" && object.id) url = `https://zhuanlan.zhihu.com/p/${object.id}`;
      else if (object.type === "answer" && object.id && object.question?.id) url = `https://www.zhihu.com/question/${object.question.id}/answer/${object.id}`;
      else if (object.type === "question" && object.id) url = `https://www.zhihu.com/question/${object.id}`;
      if (!url) return null;
      const timestamp = Number(object.created_time || object.updated_time || 0);
      const title = strip(object.title || object.question?.name || "");
      const excerpt = strip(object.excerpt || object.description || object.content || "");
      return {
        marker: `api-${index}`, url, title: strip(object.author?.name || title || "公开用户"),
        snippet: `${title} ${excerpt}`.trim().slice(0, 780),
        publishedHint: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : "",
        authorHint: strip(object.author?.name || ""), authorIdHint: String(object.author?.url_token || ""),
      };
    }).filter(Boolean);
  }).catch(() => []);
}

async function processSearchJob(job, queries) {
  try {
    const searchPlan = buildSearchPlan(job, queries);
    job.searchPlan = searchPlan.map((query) => query.join(" "));
    job.prefiltered = 0;
    let queryCursor = 0;
    let activeQuery = searchPlan[queryCursor];
    let page = await openControlledPage(searchUrl(job.platform, activeQuery));
    await prepareSearchPage(page, job.platform, activeQuery);
    searchJobs.set(job.jobId, { ...job, status: "running", phase: "locating", progress: 20, currentAction: `正在${job.platform}核对检索词：${activeQuery.join("、")}`, analysisTrace: [], searchPlan: searchPlan.map((query) => query.join(" ")) });
    await delay(2200);
    if (page.isClosed()) {
      page = await openControlledPage(searchUrl(job.platform, activeQuery));
      await prepareSearchPage(page, job.platform, activeQuery);
      await delay(1400);
    }
    const expectedHost = new URL(PLATFORM_URLS[job.platform]).hostname.replace(/^www\./, "");
    const seenUrls = new Set();
    const seenSnippets = new Set();
    const prefilteredUrls = new Set();
    const results = [];
    const analysisTrace = [];
    const maxItems = Math.max(1, Math.min(50, Number(job.targetItems ?? aiSettings.policy.maxItemsPerSource ?? 10)));
    let agentSteps = 0;
    let refinements = 0;
    let pendingRefine = "";
    let anchorCount = 0;
    let emptyScreens = 0;
    let inspectedForQuery = 0;
    const perQueryQuota = Math.max(1, Math.min(2, Number(job.itemsPerQuery ?? 2)));
    const maxSearchScreens = Math.min(60, Math.max(12, maxItems * 3, searchPlan.length * 3));
    for (let screen = 0; screen < maxSearchScreens && analysisTrace.length < maxItems && agentSteps < Math.max(aiSettings.policy.maxStepsPerSource, maxItems * 2); screen += 1) {
      if (searchJobs.get(job.jobId)?.status === "cancelled") return;
      if (page.isClosed()) {
        page = await openControlledPage(searchUrl(job.platform, activeQuery));
        await prepareSearchPage(page, job.platform, activeQuery);
        await page.waitForTimeout(1400);
      }
      const rankedApiResults = await readRankedZhihuSearchResults(page);
      const batch = rankedApiResults.length ? rankedApiResults : await page.locator("a[href]").evaluateAll((elements, screenIndex) => elements.map((element, index) => {
        const anchor = element;
        const container = anchor.closest("article, li, section, [role='listitem'], .pbw, .SearchResult-Card, [class*='SearchResult'], [class*='ContentItem'], [class*='note-item'], [class*='search-result'], [class*='feed-card']") || anchor;
        const snippet = String(container?.innerText || anchor.innerText || "").replace(/\s+/g, " ").trim();
        const marker = `xt-${screenIndex}-${index}`;
        anchor.setAttribute("data-xintan-candidate", marker);
        const timeElement = container?.querySelector(".ContentItem-time, time, [datetime], [data-tooltip*='发布于'], [data-tooltip*='编辑于']");
        const publishedHint = String(timeElement?.getAttribute("datetime") || timeElement?.getAttribute("data-tooltip") || timeElement?.textContent || "").replace(/\s+/g, " ").trim();
        return { marker, url: anchor.href, title: String(anchor.innerText || "").replace(/\s+/g, " ").trim(), snippet, publishedHint };
      }), screen).catch(() => []);
      anchorCount = Math.max(anchorCount, batch.length);
      const rangeDays = Number(String(job.timeRange || "近30天").match(/\d+/)?.[0] ?? 30);
      const candidates = batch.map((item) => ({ ...item, hintedDate: parseVisibleDate(item.publishedHint) })).sort((left, right) => {
        if (left.hintedDate && right.hintedDate) return right.hintedDate.getTime() - left.hintedDate.getTime();
        if (left.hintedDate) return -1;
        if (right.hintedDate) return 1;
        return 0;
      }).filter((item) => {
        try {
          const parsed = new URL(item.url);
          const snippetKey = item.snippet.replace(/\s+/g, " ").trim().slice(0, 240);
          const boilerplate = /Powered by Discuz|ICP备|document\.createElement\(["']script|关于我们.*举报/i.test(item.snippet);
          const tooOld = item.hintedDate && item.hintedDate.getTime() < Date.now() - rangeDays * 86_400_000;
          if (tooOld) prefilteredUrls.add(parsed.toString());
          return !tooOld && !prefilteredUrls.has(parsed.toString()) && parsed.hostname.replace(/^www\./, "").endsWith(expectedHost) && isContentUrl(job.platform, parsed) && !boilerplate
            && item.snippet.length >= 12 && item.snippet.length <= 800 && !seenUrls.has(parsed.toString()) && !seenSnippets.has(snippetKey);
        } catch { return false; }
      }).slice(0, Math.max(0, Math.min(maxItems - analysisTrace.length, perQueryQuota - inspectedForQuery)));
      job.prefiltered = prefilteredUrls.size;
      if (candidates.length) emptyScreens = 0;
      else emptyScreens += 1;
      for (const candidate of candidates) {
        if (searchJobs.get(job.jobId)?.status === "cancelled") return;
        const parsed = new URL(candidate.url);
        seenUrls.add(parsed.toString());
        seenSnippets.add(candidate.snippet.replace(/\s+/g, " ").trim().slice(0, 240));
        const item = { ...candidate, platform: job.platform, snippet: candidate.snippet.slice(0, 800) };
        const position = analysisTrace.length + 1;
        inspectedForQuery += 1;
        const projectedTotal = maxItems;
        const pendingTrace = { index: position, url: parsed.toString(), snippet: item.snippet, author: String(candidate.authorHint || candidate.title || "公开用户").slice(0, 60), authorId: String(candidate.authorIdHint || ""), publishedAt: candidate.publishedHint || "", status: "opening_detail", decision: "待判断", reason: "电脑Agent正在打开详情并读取正文", tags: [], matchedKeywords: [], evidenceQuotes: [], detailExcerpt: "", intent: "无", intelligenceType: "待判断", score: 0, priority: "C", nextAction: "open_source", actionReason: "每条候选必须进入详情深读", confidence: 0, policyStatus: "正在校验站内详情地址", model: aiSettings.model };
        searchJobs.set(job.jobId, {
          ...job, status: "running", phase: "opening_detail", progress: Math.min(88, 26 + position * 5), fetched: results.length,
          inspected: position, kept: results.length, filtered: analysisTrace.filter((entry) => entry.decision === "过滤").length,
          currentAction: `已在搜索页预过滤 ${prefilteredUrls.size} 条旧内容；正在按时间优先打开第 ${position} 条详情：${pendingTrace.author}`,
          currentItem: pendingTrace, analysisTrace: [...analysisTrace, pendingTrace],
        });
        try {
        await showItemAnalysis(page, item, { decision: "打开详情", priority: "-", score: 0, reason: "强制逐条进入站内原文，不使用列表摘要直接定案", keep: true }, position, projectedTotal, "reading");
        await delay(700);
        const detailPolicy = enforceAgentPolicy({ nextAction: "open_source", decision: "needs_more" }, job, item);
        if (!detailPolicy.allowed) throw new Error(`详情打开被安全策略阻止：${detailPolicy.reason}`);
        const searchPageUrl = page.url();
        const searchScrollY = await page.evaluate(() => window.scrollY).catch(() => 0);
        await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(1400);
        const landedUrl = page.url();
        const landedHost = new URL(landedUrl).hostname.replace(/^www\./, "");
        if (!landedHost.endsWith(expectedHost)) throw new Error("详情页跳转超出平台白名单域名");
        await readDetailProgressively(page, { job, position, pendingTrace, results, analysisTrace });
        const detailText = await extractDetailContent(page);
        const publicMeta = await extractPublicMetadata(page, pendingTrace.author, pendingTrace.publishedAt, pendingTrace.authorId);
        const metadataTrace = { ...pendingTrace, author: publicMeta.author, authorId: publicMeta.authorId, publishedAt: publicMeta.publishedAt };
        const hardFilter = hardFilterReasons(job, publicMeta, detailText);
        const visualFrames = [];
        const firstFrame = await page.screenshot({ type: "jpeg", quality: 45 }).catch(() => null);
        if (firstFrame) visualFrames.push(`data:image/jpeg;base64,${firstFrame.toString("base64")}`);
        const hasVideo = await page.locator("video").count().then((count) => count > 0).catch(() => false);
        if (hasVideo) {
          await page.locator("video").first().evaluate((video) => video.play().catch(() => undefined)).catch(() => undefined);
          await page.waitForTimeout(1800);
          const secondFrame = await page.screenshot({ type: "jpeg", quality: 45 }).catch(() => null);
          if (secondFrame) visualFrames.push(`data:image/jpeg;base64,${secondFrame.toString("base64")}`);
        }
        const commentTexts = hardFilter.reasons.length ? [] : await readCommentsProgressively(page, { job: { ...job, targetItems: maxItems }, position, target: Math.max(1, Math.min(50, Number(job.commentTarget ?? 20))), pendingTrace: metadataTrace, results, analysisTrace });
        const detailExcerpt = detailText.slice(0, 520);
        const readingTrace = { ...metadataTrace, status: "reading_detail", reason: "正在提取正文、公开评论和可回溯证据", detailExcerpt, commentRead: commentTexts.length, commentTarget: Math.max(1, Math.min(50, Number(job.commentTarget ?? 20))), policyStatus: "站内详情地址校验通过" };
        searchJobs.set(job.jobId, {
          ...job, status: "running", phase: "reading_detail", progress: Math.min(90, 28 + position * 5), fetched: results.length,
          inspected: position, kept: results.length, filtered: analysisTrace.length - results.length,
          currentAction: `第 ${position}/${maxItems} 条深读完成：${hasVideo ? `观察视频画面 ${visualFrames.length} 帧，` : ""}正文 ${detailText.length} 字，逐条阅读评论 ${commentTexts.length} 条`,
          currentItem: readingTrace, analysisTrace: [...analysisTrace, readingTrace],
        });
        await showItemAnalysis(page, { ...item, marker: "" }, { decision: "深读详情", priority: "-", score: 0, reason: `正文 ${detailText.length} 字 · 公开评论 ${commentTexts.length} 条 · 随后交给AI判断`, keep: true }, position, projectedTotal, "detail");
        const aiObservation = {
          task: { name: job.taskName ?? "猎头情报任务", techKeywords: job.techKeywords, companyKeywords: job.companyKeywords, signalKeywords: job.signalKeywords, excludeKeywords: job.excludeKeywords, timeRange: job.timeRange },
          platform: job.platform, pageUrl: landedUrl, candidate: { author: publicMeta.author, authorId: publicMeta.authorId, publishedAt: publicMeta.publishedAt, listSnippet: item.snippet, url: item.url },
          mandatoryDeepRead: { contentKind: hasVideo ? "视频" : "图文", visibleDetail: detailText.slice(0, 5000), publicComments: commentTexts.join("\n").slice(0, 4000), detailCharacters: detailText.length, publicCommentBlocks: commentTexts.length, visualFrameCount: visualFrames.length },
          visualFrames,
          progress: { item: position, inspected: analysisTrace.length, kept: results.length },
          safeActions: ["keep", "filter", "refine_search", "scroll_next", "cross_check", "stop"],
          instruction: "这是已打开的详情页。必须引用详情证据给出最终判断；不要再次要求打开原文或读取评论。",
        };
        searchJobs.set(job.jobId, {
          ...job, status: "running", phase: "calling_ai", progress: Math.min(91, 29 + position * 5), fetched: results.length,
          inspected: position, kept: results.length, filtered: analysisTrace.length - results.length,
          currentAction: `第 ${position}/${maxItems} 条已完成证据采集，正在调用AI中枢判断`,
          currentItem: readingTrace, analysisTrace: [...analysisTrace, readingTrace],
        });
        let aiFailure = "";
        let brainDecision;
        if (hardFilter.reasons.length) {
          brainDecision = {
            decision: "filter", reasoningSummary: hardFilter.reasons.join("；"), nextAction: "scroll_next",
            actionReason: "硬过滤规则在AI判断前生效，继续处理下一候选", searchQuery: "", crossCheckPlatform: "",
            tags: ["规则过滤"], matchedKeywords: hardFilter.excludeMatches, evidenceQuotes: [], intent: "无", intelligenceType: "无效内容",
            contentType: "irrelevant", companyIntelligenceType: "unknown", jobMatchScore: 0, intentScore: 0, companyIntelScore: 0,
            identityConfidence: 0, evidenceConfidence: 1, uncertainty: [], recommendedAction: "ignore",
            score: 0, priority: "C", confidence: 1, stopReason: "命中时间或黑名单规则", model: "policy-engine", responseId: "", latencyMs: 0, retryCount: 0,
          };
        } else try {
          brainDecision = await askAiBrainWithRetry(aiObservation);
        } catch (error) {
          aiFailure = error instanceof Error ? error.message : String(error);
          brainDecision = {
            decision: "needs_more", reasoningSummary: `正文与公开信息已采集，但AI中枢两次调用失败，本条进入人工复核：${aiFailure.slice(0, 160)}`,
            nextAction: "scroll_next", actionReason: "单条AI故障不终止整轮任务，继续处理下一候选", searchQuery: "", crossCheckPlatform: "",
            tags: ["AI待复核"], matchedKeywords: [], evidenceQuotes: [], intent: "无", intelligenceType: "无效内容",
            contentType: "uncertain", companyIntelligenceType: "unknown", jobMatchScore: 0, intentScore: 0, companyIntelScore: 0,
            identityConfidence: 0, evidenceConfidence: 0, uncertainty: ["AI调用失败"], recommendedAction: "human_review",
            score: 0, priority: "C", confidence: 0, stopReason: "AI调用失败", model: aiSettings.model, responseId: "", latencyMs: 0, retryCount: 1,
          };
        }
        agentSteps += 2;
        let policy = enforceAgentPolicy(brainDecision, job, item);
        if (["open_source", "read_comments"].includes(policy.action)) policy = { ...policy, action: "scroll_next", reason: `${policy.reason}；详情与公开评论已完成强制读取` };
        if (policy.action === "stop" && position < maxItems) policy = { ...policy, action: "scroll_next", reason: `${policy.reason}；单条内容判断结束不等于整个平台任务结束，继续寻找直到 ${maxItems} 条` };
        const executedAction = `打开详情 → 读取正文${commentTexts.length ? `与${commentTexts.length}条公开评论` : "（未检测到公开评论）"} → ${policy.action}`;
        await page.goto(searchPageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
        await page.evaluate((scrollY) => window.scrollTo(0, scrollY), searchScrollY).catch(() => undefined);
        await page.waitForTimeout(700);
        const keep = brainDecision.decision === "keep";
        const exploring = brainDecision.decision === "needs_more" && ["refine_search", "cross_check", "scroll_next"].includes(policy.action);
        const analysis = {
          keep, decision: keep ? "保留" : exploring ? "继续探索" : "过滤", reason: brainDecision.reasoningSummary,
          tags: brainDecision.tags, matchedKeywords: brainDecision.matchedKeywords, intent: brainDecision.intent,
          intelligenceType: brainDecision.intelligenceType, score: brainDecision.score, priority: brainDecision.priority,
          reasoningSummary: brainDecision.reasoningSummary, nextAction: executedAction, actionReason: brainDecision.actionReason,
          confidence: brainDecision.confidence, stopReason: brainDecision.stopReason, policyStatus: policy.reason,
          model: brainDecision.model, responseId: brainDecision.responseId, evidenceQuotes: brainDecision.evidenceQuotes, detailExcerpt,
          latencyMs: brainDecision.latencyMs, retryCount: brainDecision.retryCount, contentType: brainDecision.contentType,
          companyIntelligenceType: brainDecision.companyIntelligenceType, recommendedAction: brainDecision.recommendedAction,
          commentRead: commentTexts.length, commentTarget: Math.max(1, Math.min(50, Number(job.commentTarget ?? 20))), contentKind: hasVideo ? "视频" : "图文",
          aiError: aiFailure,
        };
        const finishedTrace = { ...metadataTrace, ...analysis, status: "completed" };
        analysisTrace.push(finishedTrace);
        if (analysis.keep) {
          results.push({
            source: job.platform, externalId: parsed.toString(), url: parsed.toString(),
            author: publicMeta.author, authorId: publicMeta.authorId, publishedAt: publicMeta.publishedAt, snippet: detailExcerpt || item.snippet,
            raw: { aiAnalysis: {
              tags: brainDecision.tags, intent: brainDecision.intent, intelligenceType: brainDecision.intelligenceType,
              contentType: brainDecision.contentType, companyIntelligenceType: brainDecision.companyIntelligenceType,
              jobMatchScore: brainDecision.jobMatchScore, intentScore: brainDecision.intentScore, companyIntelScore: brainDecision.companyIntelScore,
              identityConfidence: brainDecision.identityConfidence, evidenceConfidence: brainDecision.evidenceConfidence,
              uncertainty: brainDecision.uncertainty, recommendedAction: brainDecision.recommendedAction,
              score: brainDecision.score, reasoningSummary: brainDecision.reasoningSummary,
              companyNote: brainDecision.reasoningSummary, evidenceQuotes: brainDecision.evidenceQuotes,
              confidence: brainDecision.confidence, model: brainDecision.model, responseId: brainDecision.responseId,
              latencyMs: brainDecision.latencyMs, retryCount: brainDecision.retryCount,
            } },
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
        } catch (itemError) {
          const message = itemError instanceof Error ? itemError.message : String(itemError);
          const recoveryTrace = {
            ...pendingTrace, status: "completed", decision: "过滤", reason: `详情页读取异常，已跳过并自动恢复：${message.slice(0, 160)}`,
            tags: ["页面异常"], matchedKeywords: [], evidenceQuotes: [], intent: "无", intelligenceType: "无效内容",
            score: 0, priority: "C", nextAction: "reopen_search", actionReason: "单条页面故障不终止整轮任务",
            confidence: 1, policyStatus: "自动恢复", model: "recovery-engine",
          };
          analysisTrace.push(recoveryTrace);
          agentSteps += 1;
          searchJobs.set(job.jobId, {
            ...job, status: "running", phase: "recovering", progress: Math.min(90, 30 + position * 5), fetched: results.length,
            inspected: analysisTrace.length, kept: results.length, filtered: analysisTrace.length - results.length,
            currentAction: `第 ${position} 条页面异常，正在重开知乎检索页并继续下一条`, currentItem: recoveryTrace, analysisTrace: [...analysisTrace],
          });
          page = await openControlledPage(searchUrl(job.platform, activeQuery));
          await prepareSearchPage(page, job.platform, activeQuery);
          await page.waitForTimeout(1400);
        }
      }
      if (analysisTrace.length >= maxItems || agentSteps >= Math.max(aiSettings.policy.maxStepsPerSource, maxItems * 2)) break;
      if (pendingRefine) {
        const refinedUrl = searchUrl(job.platform, [pendingRefine]);
        await page.goto(refinedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
        await prepareSearchPage(page, job.platform, [pendingRefine]);
        await page.waitForTimeout(1600);
        pendingRefine = "";
        emptyScreens = 0;
        inspectedForQuery = 0;
        continue;
      }
      if (inspectedForQuery >= perQueryQuota && queryCursor + 1 < searchPlan.length) {
        queryCursor += 1;
        activeQuery = searchPlan[queryCursor];
        searchJobs.set(job.jobId, { ...job, status: "running", phase: "refining_search", progress: Math.min(88, 34 + analysisTrace.length * 5), fetched: results.length, inspected: analysisTrace.length, kept: results.length, filtered: analysisTrace.length - results.length, currentAction: `本组已深读 ${inspectedForQuery} 条，轮换第 ${queryCursor + 1}/${searchPlan.length} 组：${activeQuery.join("、")}`, analysisTrace: [...analysisTrace] });
        await page.goto(searchUrl(job.platform, activeQuery), { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
        await prepareSearchPage(page, job.platform, activeQuery);
        await page.waitForTimeout(1600);
        inspectedForQuery = 0;
        emptyScreens = 0;
        continue;
      }
      if (emptyScreens >= 3 && queryCursor + 1 < searchPlan.length) {
        queryCursor += 1;
        activeQuery = searchPlan[queryCursor];
        searchJobs.set(job.jobId, { ...job, status: "running", phase: "refining_search", progress: Math.min(88, 34 + analysisTrace.length * 5), fetched: results.length, inspected: analysisTrace.length, kept: results.length, filtered: analysisTrace.length - results.length, currentAction: `当前关键词没有新候选，切换第 ${queryCursor + 1}/${searchPlan.length} 组：${activeQuery.join("、")}`, analysisTrace: [...analysisTrace] });
        await page.goto(searchUrl(job.platform, activeQuery), { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
        await prepareSearchPage(page, job.platform, activeQuery);
        await page.waitForTimeout(1600);
        emptyScreens = 0;
        inspectedForQuery = 0;
        continue;
      }
      if (emptyScreens >= 3 && queryCursor + 1 >= searchPlan.length) break;
      searchJobs.set(job.jobId, { ...job, status: "running", phase: "loading_more", progress: Math.min(86, 35 + analysisTrace.length * 4), fetched: results.length, inspected: analysisTrace.length, kept: results.length, filtered: analysisTrace.length - results.length, currentAction: `当前屏内容已分析，向下加载更多结果`, analysisTrace: [...analysisTrace] });
      await scrollPageVisibly(page, Math.max(650, await page.evaluate(() => window.innerHeight * 0.78).catch(() => 700)));
      await page.waitForTimeout(1100);
    }
    const title = await page.title().catch(() => "");
    if (searchJobs.get(job.jobId)?.status === "cancelled") return;
    const finalPageUrl = page.isClosed() ? searchUrl(job.platform, activeQuery) : page.url();
    const needsLogin = /登录|sign in|login/i.test(`${title} ${finalPageUrl}`) && results.length === 0;
    const targetReached = analysisTrace.length >= maxItems;
    const finalStatus = needsLogin ? "waiting_login" : targetReached ? "completed" : "partial";
    searchJobs.set(job.jobId, {
      ...job, status: finalStatus, phase: needsLogin ? "waiting_login" : targetReached ? "completed" : "partial", progress: 100,
      fetched: results.length, inspected: analysisTrace.length, kept: results.length, filtered: analysisTrace.length - results.length + prefilteredUrls.size, prefiltered: prefilteredUrls.size, results, analysisTrace,
      currentItem: analysisTrace.at(-1),
      targetItems: maxItems,
      currentAction: needsLogin ? `${job.platform}需要登录后继续` : targetReached ? `${job.platform}已先过滤 ${prefilteredUrls.size} 条旧结果，再逐条深读 ${analysisTrace.length}/${maxItems} 条，保留 ${results.length} 条` : `${job.platform}仅完成 ${analysisTrace.length}/${maxItems} 条：搜索页已预过滤 ${prefilteredUrls.size} 条旧内容，当前没有更多近期候选`,
      diagnostic: results.length ? undefined : { pageUrl: finalPageUrl, pageTitle: title, anchorCount },
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const current = searchJobs.get(job.jobId) ?? job;
    const failureMessage = error instanceof Error ? error.message : String(error);
    const isAiFailure = current.phase === "calling_ai" || /AI中枢|模型服务|Responses API|API Key|结构化决策|aborted|timeout|fetch failed/i.test(failureMessage);
    searchJobs.set(job.jobId, {
      ...current, status: "failed", phase: "failed", progress: 100, results: [], error: failureMessage,
      currentAction: failureMessage.includes("ProcessSingleton")
        ? "芯探专用浏览器正在被旧进程占用，请关闭旧窗口后重试"
        : isAiFailure
          ? `AI中枢调用失败：${failureMessage.slice(0, 180)}`
          : `执行失败：${failureMessage.slice(0, 180)}`,
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
      version: ASSISTANT_VERSION,
      operatorWindow: "direct",
      operatingSystem: OPERATING_SYSTEM, browserExecutableDetected: Boolean(BROWSER_EXECUTABLE),
      capabilities: ["zhihu_only", "open_platform", "direct_operator_window", "browser_sessions", "search_tasks", "import_analysis", "official_search_metadata", "freshness_first", "background_scheduler", "central_ai_brain", "ai_retry", "ai_fail_soft", "policy_guard", "agent_loop", "query_rotation", "strict_time_filter", "blacklist_filter", "sequential_comment_read", "visual_frame_analysis", "mandatory_detail_read", "evidence_quotes", "per_item_analysis", "analysis_audit", "source_verifications", "heartbeat", "cross_platform_browser_detection"],
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/heartbeat") {
    const jobs = [...searchJobs.values()];
    return json(response, 200, {
      ok: true, version: ASSISTANT_VERSION, operatingSystem: OPERATING_SYSTEM,
      startedAt: ASSISTANT_STARTED_AT, checkedAt: new Date().toISOString(),
      browser: { connected: Boolean(browserContext), executableDetected: Boolean(BROWSER_EXECUTABLE) },
      sessions: Object.entries(sessionStates).map(([platform, state]) => ({ platform, ...state })),
      jobs: { active: jobs.filter((job) => ["running", "waiting_login"].includes(job.status)).length, total: jobs.length },
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
          maxStepsPerSource: Math.max(4, Math.min(120, Number(incomingPolicy.maxStepsPerSource ?? aiSettings.policy.maxStepsPerSource))),
          maxItemsPerSource: Math.max(1, Math.min(50, Number(incomingPolicy.maxItemsPerSource ?? aiSettings.policy.maxItemsPerSource))),
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
      const verificationPromise = operationQueue.then(() => verifyPlatform(String(platform)));
      operationQueue = verificationPromise.catch(() => undefined);
      const verification = await verificationPromise;
      return json(response, verification.status === "passed" ? 200 : 422, { verification });
    } catch {
      return json(response, 400, { error: "功能验收请求格式不正确" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/import-analysis") {
    try {
      if (aiSettings.status !== "connected" || !aiSettings.apiKey) return json(response, 409, { error: "请先在AI中枢配置模型并通过连接测试" });
      const payload = await readJson(request);
      const items = Array.isArray(payload.items) ? payload.items.slice(0, 500) : [];
      if (!items.length) return json(response, 400, { error: "没有可分析的导入内容" });
      const results = await analyzeImportedItems(items, payload.task ?? {});
      return json(response, 200, {
        results,
        items: results.filter((result) => result?.status === "accepted").map((result) => result.item),
        accepted: results.filter((result) => result?.status === "accepted").length,
        filtered: results.filter((result) => result?.status === "filtered").length,
        failed: results.filter((result) => result?.status === "failed").length,
      });
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : "导入分析失败" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/search-tasks") {
    try {
      if (aiSettings.status !== "connected" || !aiSettings.apiKey) return json(response, 409, { error: "请先在AI中枢配置模型并通过连接测试" });
      const payload = await readJson(request);
      if (String(payload.platform ?? "知乎") !== "知乎") return json(response, 400, { error: "当前版本只支持知乎" });
      const job = buildSearchJob(payload);
      searchJobs.set(job.jobId, job);
      operationQueue = operationQueue.then(() => processSearchJob(job, job.queries));
      void operationQueue;
      return json(response, 202, job);
    } catch {
      return json(response, 400, { error: "任务格式不正确" });
    }
  }
  if (request.method === "GET" && url.pathname === "/v1/scheduler/status") {
    return json(response, 200, { running: schedulerRunning, lastRunAt: schedulerLastRunAt, lastError: schedulerLastError, appBaseUrl: APP_BASE_URL });
  }
  if (request.method === "POST" && url.pathname === "/v1/scheduler/run-due") {
    const payload = await readJson(request).catch(() => ({}));
    const result = await runDueTasks({ force: payload.force === true, taskId: String(payload.taskId ?? "") });
    return json(response, result.ok ? 200 : result.status === "busy" ? 409 : 500, result);
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

const schedulerTimer = setInterval(() => { void runDueTasks(); }, 60_000);
schedulerTimer.unref();

async function shutdown() {
  await browserContext?.close().catch(() => undefined);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
