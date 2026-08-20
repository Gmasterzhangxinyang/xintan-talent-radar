import { analyzeCandidate } from "./analyzer";
import { collectPublicForum, dispatchComputerAgent, SOCIAL_SOURCES } from "./connectors";
import { contentHash } from "./dedupe";
import { parseStringArray } from "./json";
import type { CandidateItem, IngestStats, TaskRecord } from "./types";

function allowedByTime(value: string | undefined, range: string) {
  if (!value) return true;
  const days = Number(range.match(/\d+/)?.[0] ?? 30);
  const time = Date.parse(value);
  return Number.isNaN(time) || time >= Date.now() - days * 86_400_000;
}

function nextScheduledAt(schedule: string) {
  if (schedule === "仅手动运行") return null;
  const next = new Date(Date.now() + (schedule.includes("每周") ? 7 : 1) * 86_400_000);
  const time = schedule.match(/(\d{1,2}):(\d{2})/);
  if (time) next.setUTCHours((Number(time[1]) + 16) % 24, Number(time[2]), 0, 0);
  return next.toISOString();
}

export async function ingestCandidates(db: D1Database, task: TaskRecord, items: CandidateItem[]): Promise<IngestStats> {
  const stats: IngestStats = { fetched: items.length, filtered: 0, deduped: 0, valid: 0, highValue: 0 };
  const tech = parseStringArray(task.tech_keywords);
  const companies = parseStringArray(task.company_keywords);
  const signals = parseStringArray(task.signal_keywords);
  const excludes = parseStringArray(task.exclude_keywords).map((item) => item.toLowerCase());
  const filterRow = await db.prepare("SELECT author_blacklist, company_blacklist FROM task_filters WHERE task_id = ?").bind(task.id).first<Record<string, string>>();
  const authorBlacklist = parseStringArray(filterRow?.author_blacklist).map((item) => item.toLowerCase());
  const companyBlacklist = parseStringArray(filterRow?.company_blacklist).map((item) => item.toLowerCase());
  for (const item of items) {
    const searchable = `${item.author ?? ""} ${item.snippet}`.toLowerCase();
    let validUrl = false;
    try { validUrl = ["http:", "https:"].includes(new URL(item.url).protocol); } catch { validUrl = false; }
    if (!item.snippet.trim() || item.snippet.length > 5_000 || !validUrl || !allowedByTime(item.publishedAt, task.time_range) ||
      excludes.some((term) => searchable.includes(term)) || authorBlacklist.some((term) => (item.author ?? "").toLowerCase().includes(term)) ||
      companyBlacklist.some((term) => searchable.includes(term))) {
      stats.filtered += 1;
      continue;
    }
    const hash = await contentHash(task.id, item.source, item.snippet, item.url);
    const duplicate = await db.prepare("SELECT id FROM raw_items WHERE task_id = ? AND content_hash = ?").bind(task.id, hash).first();
    if (duplicate) { stats.deduped += 1; continue; }
    const analysis = analyzeCandidate(item.snippet, { tech, companies, signals });
    const now = new Date().toISOString();
    const publishedAt = item.publishedAt ?? "未公开";
    const rawId = `raw-${crypto.randomUUID()}`;
    const leadId = `lead-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare(`INSERT INTO raw_items (id, task_id, source, external_id, content_hash, author, author_id, published_at, source_url, snippet, raw_payload, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(rawId, task.id, item.source, item.externalId ?? "", hash, item.author ?? "未公开", item.authorId ?? "", publishedAt, item.url, item.snippet, JSON.stringify(item.raw ?? {}), now),
      db.prepare(`INSERT INTO leads (id, task_id, source, author, author_id, published_at, snippet, tags, intent, intelligence_type, priority, score, company_note, evidence, url, review_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待审核', ?)`)
        .bind(leadId, task.id, item.source, item.author ?? "未公开", item.authorId ?? "", publishedAt, item.snippet,
          JSON.stringify(analysis.tags), analysis.intent, analysis.intelligenceType, analysis.priority, analysis.score, analysis.companyNote, analysis.evidence, item.url, now),
    ]);
    stats.valid += 1;
    if (analysis.priority === "A") stats.highValue += 1;
  }
  return stats;
}

type LocalAgentJob = {
  jobId?: string;
  status?: string;
  progress?: number;
  fetched?: number;
  currentAction?: string;
  liveViewUrl?: string;
};

export async function runTask(
  db: D1Database,
  taskId: string,
  callbackBase: string,
  localJobs: Record<string, LocalAgentJob> = {},
  localCandidates: CandidateItem[] = [],
) {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<TaskRecord>();
  if (!task) throw new Error("任务不存在");
  if (task.status !== "active") throw new Error("任务已暂停，请先恢复任务");
  const runId = `run-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.prepare("INSERT INTO runs (id, task_id, task_name, started_at, status, message) VALUES (?, ?, ?, ?, '运行中', '连接器正在执行')")
    .bind(runId, task.id, task.name, startedAt).run();
  const total: IngestStats = { fetched: 0, filtered: 0, deduped: 0, valid: 0, highValue: 0 };
  const messages: string[] = [];
  for (const source of parseStringArray(task.sources)) {
    const sourceCandidates = localCandidates.filter((item) => item.source === source)
      .map((item) => ({ ...item, source }));
    if (SOCIAL_SOURCES.has(source)) {
      const localJob = localJobs[source];
      if (localJob) {
        const jobId = String(localJob.jobId ?? `local-${crypto.randomUUID()}`).slice(0, 160);
        const waitingLogin = localJob.status === "waiting_login";
        const persistedStatus = waitingLogin ? "waiting_login" : localJob.status === "failed" ? "failed" : localJob.status === "completed" ? "completed" : "dispatched";
        const liveViewUrl = String(localJob.liveViewUrl ?? "").startsWith("http://127.0.0.1:8765/") ? String(localJob.liveViewUrl) : "";
        const action = String(localJob.currentAction ?? `已在${source}打开关键词检索`).slice(0, 300);
        await db.prepare(`INSERT OR REPLACE INTO connector_jobs
          (id, task_id, source, status, dispatched_at, fetched, progress, current_action, live_view_url, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(jobId, task.id, source, persistedStatus, startedAt,
            Math.max(0, Number(localJob.fetched ?? sourceCandidates.length)), Math.max(0, Math.min(100, Number(localJob.progress ?? 10))), action, liveViewUrl, startedAt).run();
        if (sourceCandidates.length) {
          const stats = await ingestCandidates(db, task, sourceCandidates);
          for (const key of Object.keys(total) as Array<keyof IngestStats>) total[key] += stats[key];
          messages.push(`${source}:获取${stats.fetched}/新增${stats.valid}`);
        } else if (persistedStatus === "failed") {
          messages.push(`${source}:失败(${action})`);
        } else {
          messages.push(`${source}:${waitingLogin ? "等待登录" : "已打开检索页，未读取到公开结果"}`);
        }
        continue;
      }
      const job = await dispatchComputerAgent({ db, task, source, callbackBase });
      messages.push(`${source}:${job.status === "dispatched" ? "已派发" : job.status === "awaiting_config" ? "等待连接电脑助手" : job.status === "disabled" ? "已停用" : "派发失败"}`);
      continue;
    }
    try {
      const items = sourceCandidates.length ? sourceCandidates : await collectPublicForum(source, task);
      const stats = await ingestCandidates(db, task, items);
      for (const key of Object.keys(total) as Array<keyof IngestStats>) total[key] += stats[key];
      messages.push(`${source}:获取${stats.fetched}/新增${stats.valid}`);
    } catch (error) {
      messages.push(localJobs[source]
        ? `${source}:浏览器已打开（网页直采受限）`
        : `${source}:失败(${error instanceof Error ? error.message : "未知错误"})`);
    }
  }
  const finishedAt = new Date().toISOString();
  const awaiting = messages.some((message) => message.includes("等待"));
  const failed = messages.some((message) => message.includes("失败"));
  const status = failed || awaiting ? "部分完成" : messages.some((message) => message.includes("已派发")) ? "已派发" : "完成";
  await db.batch([
    db.prepare("UPDATE runs SET finished_at = ?, status = ?, fetched = ?, filtered = ?, deduped = ?, valid = ?, high_value = ?, message = ? WHERE id = ?")
      .bind(finishedAt, status, total.fetched, total.filtered, total.deduped, total.valid, total.highValue, messages.join("；"), runId),
    db.prepare("UPDATE tasks SET discovered = discovered + ?, high_value = high_value + ?, last_run_at = ? WHERE id = ?")
      .bind(total.valid, total.highValue, finishedAt, task.id),
    db.prepare(`INSERT INTO task_filters (task_id, schedule_enabled, next_run_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET schedule_enabled=excluded.schedule_enabled, next_run_at=excluded.next_run_at, updated_at=excluded.updated_at`)
      .bind(task.id, task.schedule === "仅手动运行" ? 0 : 1, nextScheduledAt(task.schedule), finishedAt),
  ]);
  return { runId, status, ...total, message: messages.join("；") };
}
