import http from "node:http";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  "EETOP": "https://bbs.eetop.cn/forum.php",
  "EDA365": "https://bbs.eda365.com/forum.php",
};
const SOCIAL_PLATFORMS = ["抖音", "微博", "小红书", "知乎"];
const searchJobs = new Map();
const verificationQueries = ["芯片", "设计"];
const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_FILE = resolve(PROJECT_DIR, "work", "local-assistant-sessions.json");
const BROWSER_PROFILE_DIR = resolve(PROJECT_DIR, "work", "browser-profile");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(resolve(PROJECT_DIR, "work"), { recursive: true });
let sessionStates = Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform, { status: "unknown", lastCheckedAt: new Date().toISOString() }]));
let verificationStates = {};
try {
  const saved = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  if (saved?.profile === "xintan-dedicated-v1") {
    sessionStates = { ...sessionStates, ...saved.sessions };
    verificationStates = saved.verifications ?? {};
  }
} catch { /* first launch */ }
let browserContext;
let browserConnection;

function saveSessions() {
  writeFileSync(SESSION_FILE, JSON.stringify({ profile: "xintan-dedicated-v1", sessions: sessionStates, verifications: verificationStates }, null, 2));
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
    args: ["--start-maximized", "--remote-debugging-port=9222", "--disable-blink-features=AutomationControlled"],
  });
  browserContext.on("close", () => { browserContext = undefined; });
  return browserContext;
}

async function openControlledPage(target) {
  const context = await ensureBrowser();
  const page = await context.newPage();
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
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
    const result = { platform, status: passed ? "passed" : "failed", checks, testedAt: new Date().toISOString(), startedAt, pageUrl: page.url(), liveViewUrl: `http://${HOST}:${PORT}/live` };
    verificationStates[platform] = result;
    saveSessions();
    return result;
  } catch (error) {
    const result = {
      platform, status: "failed", checks, testedAt: new Date().toISOString(), startedAt,
      error: error instanceof Error ? error.message : "功能验收失败", liveViewUrl: `http://${HOST}:${PORT}/live`,
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
    searchJobs.set(job.jobId, { ...job, status: "running", progress: 35, currentAction: `正在读取${job.platform}公开检索结果` });
    await page.waitForTimeout(2500);
    for (let index = 0; index < 3; index += 1) {
      await page.evaluate(() => window.scrollBy(0, Math.max(700, window.innerHeight * 0.8))).catch(() => undefined);
      await page.waitForTimeout(900);
    }
    const anchors = await page.locator("a[href]").evaluateAll((elements) => elements.map((element) => {
      const anchor = element;
      const container = anchor.closest("article, li, [role='listitem']") || anchor.parentElement;
      const snippet = String(container?.innerText || anchor.innerText || "").replace(/\s+/g, " ").trim();
      return { url: anchor.href, title: String(anchor.innerText || "").replace(/\s+/g, " ").trim(), snippet };
    })).catch(() => []);
    const expectedHost = new URL(PLATFORM_URLS[job.platform]).hostname.replace(/^www\./, "");
    const loweredQueries = queries.map((item) => item.toLowerCase()).filter(Boolean);
    const seen = new Set();
    const results = [];
    for (const item of anchors) {
      let parsed;
      try { parsed = new URL(item.url); } catch { continue; }
      if (!parsed.hostname.replace(/^www\./, "").endsWith(expectedHost)) continue;
      const snippet = item.snippet.slice(0, 800);
      if (snippet.length < 12 || snippet.length > 800 || seen.has(parsed.toString())) continue;
      if (loweredQueries.length && !loweredQueries.some((query) => snippet.toLowerCase().includes(query))) continue;
      seen.add(parsed.toString());
      results.push({
        source: job.platform, externalId: parsed.toString(), url: parsed.toString(),
        author: item.title.slice(0, 60) || "公开用户", authorId: "", publishedAt: "未公开", snippet,
      });
      if (results.length >= 30) break;
    }
    const title = await page.title().catch(() => "");
    const needsLogin = /登录|sign in|login/i.test(`${title} ${page.url()}`) && results.length === 0;
    searchJobs.set(job.jobId, {
      ...job, status: needsLogin ? "waiting_login" : "completed", progress: 100, fetched: results.length, results,
      currentAction: needsLogin ? `${job.platform}需要登录后继续` : `${job.platform}已读取 ${results.length} 条公开结果`,
      diagnostic: results.length ? undefined : { pageUrl: page.url(), pageTitle: title, anchorCount: anchors.length, samples: anchors.slice(0, 5) },
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    searchJobs.set(job.jobId, {
      ...job, status: "failed", progress: 100, fetched: 0, results: [],
      currentAction: error instanceof Error && error.message.includes("ProcessSingleton")
        ? "芯探专用浏览器正在被旧进程占用，请关闭旧窗口后重试"
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

function captureScreen(response) {
  const target = `/private/tmp/xintan-assistant-screen-${process.pid}.jpg`;
  execFile("/usr/sbin/screencapture", ["-x", "-t", "jpg", target], async (error) => {
    if (error) return json(response, 503, { error: "请在系统设置中允许屏幕录制权限" });
    try {
      const image = await readFile(target);
      response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      response.end(image);
    } catch {
      json(response, 503, { error: "请在系统设置中允许屏幕录制权限" });
    } finally {
      await unlink(target).catch(() => undefined);
    }
  });
}

const livePage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>芯探电脑实时画面</title><style>html,body{margin:0;height:100%;background:#0c0d11;color:#fff;font:14px system-ui}main{height:100%;display:grid;place-items:center;overflow:hidden}img{width:100%;height:100%;object-fit:contain}.tip{position:fixed;left:16px;top:14px;padding:7px 10px;border-radius:7px;background:#17181dcc;color:#b8b9ff}</style></head><body><main><div class="tip">芯探 · 当前电脑实时画面</div><img id="screen" alt="当前电脑画面"></main><script>const el=document.getElementById('screen');function next(){const image=new Image();image.onload=()=>{el.src=image.src;setTimeout(next,500)};image.onerror=()=>setTimeout(next,1200);image.src='/screen.jpg?t='+Date.now()}next()</script></body></html>`;

const server = http.createServer(async (request, response) => {
  allowBrowser(request, response);
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, {
      ok: true,
      name: "芯探电脑助手",
      liveViewUrl: `http://${HOST}:${PORT}/live`,
      capabilities: ["open_platform", "screen_capture", "browser_sessions", "search_tasks", "source_verifications"],
    });
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
        liveViewUrl: `http://${HOST}:${PORT}/live`, searchUrl: destination, createdAt: new Date().toISOString(),
      };
      searchJobs.set(jobId, job);
      void processSearchJob(job, queries);
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
  if (request.method === "GET" && url.pathname === "/screen.jpg") return captureScreen(response);
  if (request.method === "GET" && url.pathname === "/live") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return response.end(livePage);
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
