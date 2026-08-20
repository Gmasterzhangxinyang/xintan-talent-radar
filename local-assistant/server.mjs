import http from "node:http";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_FILE = resolve(PROJECT_DIR, "work", "local-assistant-sessions.json");
mkdirSync(resolve(PROJECT_DIR, "work"), { recursive: true });
let sessionStates = Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform, { status: "unknown", lastCheckedAt: new Date().toISOString() }]));
try { sessionStates = { ...sessionStates, ...JSON.parse(readFileSync(SESSION_FILE, "utf8")) }; } catch { /* first launch */ }

function saveSessions() {
  writeFileSync(SESSION_FILE, JSON.stringify(sessionStates, null, 2));
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
      capabilities: ["open_platform", "screen_capture", "browser_sessions"],
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/browser-sessions") {
    return json(response, 200, { sessions: SOCIAL_PLATFORMS.map((platform) => ({ platform, ...sessionStates[platform], profileName: "本机默认浏览器" })) });
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
      execFile("/usr/bin/open", [target], (error) => {
        if (error) return json(response, 500, { error: "无法打开浏览器" });
        if (SOCIAL_PLATFORMS.includes(String(platform))) {
          sessionStates[String(platform)] = { status: "browser_open", lastCheckedAt: new Date().toISOString() };
          saveSessions();
        }
        json(response, 200, { ok: true, message: `已在本机浏览器打开${platform}` });
      });
    } catch {
      return json(response, 400, { error: "请求格式不正确" });
    }
    return;
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
