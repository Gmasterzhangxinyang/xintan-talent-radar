import { env } from "cloudflare:workers";
import type { CandidateItem, TaskRecord } from "./types";
import { parseStringArray, unique } from "./json";
import { loadConnectorSettings, validateAgentEndpoint } from "./connector-settings";

const FORUMS: Record<string, string> = {};
export const SOCIAL_SOURCES = new Set(["知乎"]);

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
  let sourceLimits: Record<string, number> = {};
  try { sourceLimits = JSON.parse(args.task.source_limits || "{}"); } catch { /* use default */ }
  const body = {
    jobId: id, taskId: args.task.id, platform: args.source, queries,
    taskName: args.task.name, techKeywords: parseStringArray(args.task.tech_keywords), companyKeywords: parseStringArray(args.task.company_keywords),
    signalKeywords: parseStringArray(args.task.signal_keywords), excludeKeywords: parseStringArray(args.task.exclude_keywords), timeRange: args.task.time_range,
    authorBlacklist: parseStringArray(args.task.author_blacklist), companyBlacklist: parseStringArray(args.task.company_blacklist),
    targetItems: Math.max(1, Math.min(50, Number(sourceLimits.知乎 ?? 10))), commentTarget: 20,
    fields: ["snippet", "author", "authorId", "publishedAt", "url"],
    browser: {
      reuseExistingProfile: true, interactive: true, requireExistingLogin: true,
      requireLiveView: false, liveViewMode: "direct_operator_window", heartbeatIntervalMs: 5_000,
      pauseOnViewerDisconnect: false,
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
