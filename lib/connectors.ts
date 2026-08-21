import { env } from "cloudflare:workers";
import type { CandidateItem, TaskRecord } from "./types";
import { parseStringArray, unique } from "./json";
import { loadConnectorSettings, validateAgentEndpoint } from "./connector-settings";

const FORUMS: Record<string, string> = {
  EDA365: "https://bbs.eda365.com/forum.php",
};
export const SOCIAL_SOURCES = new Set(["抖音", "微博", "小红书", "知乎"]);

function plainText(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

export async function collectPublicForum(source: string, task: TaskRecord): Promise<CandidateItem[]> {
  const root = FORUMS[source];
  if (!root) return [];
  const response = await fetch(root, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; XintanTalentRadar/1.0; public-index-validation)" } });
  if (!response.ok) throw new Error(`${source} HTTP ${response.status}`);
  const html = await response.text();
  const keywords = unique([
    ...parseStringArray(task.tech_keywords), ...parseStringArray(task.company_keywords),
    ...parseStringArray(task.signal_keywords),
  ]).map((item) => item.toLowerCase());
  const candidates: CandidateItem[] = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const title = plainText(match[2]);
    if (title.length < 6 || title.length > 180) continue;
    if (keywords.length && !keywords.some((keyword) => title.toLowerCase().includes(keyword))) continue;
    let url: string;
    try { url = new URL(match[1], root).toString(); } catch { continue; }
    if (!new URL(url).hostname.endsWith(new URL(root).hostname)) continue;
    candidates.push({ source, externalId: url, author: "公开论坛用户", publishedAt: new Date().toISOString(), snippet: title, url });
    if (candidates.length >= 20) break;
  }
  return candidates;
}

export async function dispatchComputerAgent(args: { db: D1Database; task: TaskRecord; source: string; callbackBase: string }) {
  const config = env as unknown as Record<string, unknown>;
  const saved = await loadConnectorSettings(args.db);
  const endpoint = saved?.endpoint || (typeof config.COMPUTER_AGENT_URL === "string" ? config.COMPUTER_AGENT_URL.replace(/\/$/, "") : "");
  const token = saved?.token_secret || (typeof config.COMPUTER_AGENT_TOKEN === "string" ? config.COMPUTER_AGENT_TOKEN : "");
  const id = `job-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  if (saved && !saved.enabledSources.includes(args.source)) {
    await args.db.prepare("INSERT INTO connector_jobs (id, task_id, source, status, dispatched_at, error, current_action, updated_at) VALUES (?, ?, ?, 'disabled', ?, ?, ?, ?)")
      .bind(id, args.task.id, args.source, now, "该平台已在连接设置中停用", "未派发", now).run();
    return { id, status: "disabled" };
  }
  if (!endpoint) {
    await args.db.prepare("INSERT INTO connector_jobs (id, task_id, source, status, dispatched_at, error, current_action, updated_at) VALUES (?, ?, ?, 'awaiting_config', ?, ?, ?, ?)")
      .bind(id, args.task.id, args.source, now, "请先启动并连接本地电脑助手", "尚未派发", now).run();
    return { id, status: "awaiting_config" };
  }
  const queries = unique([...parseStringArray(args.task.tech_keywords), ...parseStringArray(args.task.company_keywords), ...parseStringArray(args.task.signal_keywords)]);
  const body = {
    jobId: id, taskId: args.task.id, platform: args.source, queries,
    excludeKeywords: parseStringArray(args.task.exclude_keywords), timeRange: args.task.time_range,
    fields: ["snippet", "author", "authorId", "publishedAt", "url"],
    browser: {
      reuseExistingProfile: true, interactive: true, requireExistingLogin: true,
      requireLiveView: true, liveViewMode: "webrtc", heartbeatIntervalMs: 5_000,
      pauseOnViewerDisconnect: true,
    },
    callbackUrl: `${args.callbackBase}/api/connectors/computer-agent/callback`,
  };
  try {
    const response = await fetch(`${endpoint}/v1/search-tasks`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const accepted = await response.json().catch(() => ({})) as { liveViewUrl?: string; viewerUrl?: string };
    let liveViewUrl = saved?.live_view_url ?? "";
    const proposedLiveUrl = String(accepted.liveViewUrl ?? accepted.viewerUrl ?? "");
    if (proposedLiveUrl) liveViewUrl = validateAgentEndpoint(proposedLiveUrl);
    if (!liveViewUrl) {
      await fetch(`${endpoint}/v1/search-tasks/${id}/cancel`, {
        method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
      throw new Error("电脑助手未建立实时同屏，任务没有执行");
    }
    await args.db.prepare("INSERT INTO connector_jobs (id, task_id, source, status, dispatched_at, progress, current_action, live_view_url, updated_at) VALUES (?, ?, ?, 'dispatched', ?, 5, ?, ?, ?)")
      .bind(id, args.task.id, args.source, now, `正在启动${args.source}浏览器`, liveViewUrl, now).run();
    return { id, status: "dispatched", liveViewUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "派发失败";
    await args.db.prepare("INSERT INTO connector_jobs (id, task_id, source, status, dispatched_at, error, current_action, updated_at) VALUES (?, ?, ?, 'failed', ?, ?, ?, ?)")
      .bind(id, args.task.id, args.source, now, message, "派发失败", now).run();
    return { id, status: "failed", error: message };
  }
}
