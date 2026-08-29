import { collectPublicForum, dispatchComputerAgent, SOCIAL_SOURCES } from "./connectors";
import { parseStringArray } from "./json";
import type { CandidateItem, IngestStats, TaskRecord } from "./types";
import { ingestCandidates } from "./pipeline/ingest";
import { recordRunEvent } from "./runs/logger";
import { assertRunTransition, type RunStatus } from "./runs/state-machine";

export { ingestCandidates } from "./pipeline/ingest";

function nextScheduledAt(schedule: string) {
  if (schedule === "仅手动运行") return null;
  const next = new Date(Date.now() + (schedule.includes("每周") ? 7 : 1) * 86_400_000);
  const time = schedule.match(/(\d{1,2}):(\d{2})/);
  if (time) next.setUTCHours((Number(time[1]) + 16) % 24, Number(time[2]), 0, 0);
  return next.toISOString();
}

type LocalAgentJob = {
  jobId?: string;
  status?: string;
  progress?: number;
  fetched?: number;
  currentAction?: string;
  phase?: string;
  inspected?: number;
  kept?: number;
  filtered?: number;
  currentItem?: unknown;
  analysisTrace?: unknown[];
  liveViewUrl?: string;
  targetItems?: number;
  triggerMode?: string;
  prefiltered?: number;
};

export async function runTask(
  db: D1Database,
  taskId: string,
  callbackBase: string,
  localJobs: Record<string, LocalAgentJob> = {},
  localCandidates: CandidateItem[] = [],
) {
  const task = await db.prepare("SELECT t.*, f.source_limits, f.author_blacklist, f.company_blacklist FROM tasks t LEFT JOIN task_filters f ON f.task_id=t.id WHERE t.id = ?").bind(taskId).first<TaskRecord>();
  if (!task) throw new Error("任务不存在");
  if (task.status !== "active") throw new Error("任务已暂停，请先恢复任务");
  const runId = `run-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString();
  await db.prepare("DELETE FROM task_run_locks WHERE expires_at < ?").bind(startedAt).run();
  const lock = await db.prepare("INSERT OR IGNORE INTO task_run_locks (task_id, run_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(task.id, runId, startedAt, expiresAt).run();
  if (Number(lock.meta.changes ?? 0) !== 1) {
    const existing = await db.prepare("SELECT run_id FROM task_run_locks WHERE task_id=?").bind(task.id).first<{ run_id: string }>();
    return {
      runId: existing?.run_id ?? "", status: "already_running", reused: true,
      fetched: 0, filtered: 0, deduped: 0, valid: 0, highValue: 0,
      message: "该任务已有扫描正在运行，已返回现有运行记录",
    };
  }
  try {
    let runStatus: RunStatus = "queued";
    await db.prepare("INSERT INTO runs (id, task_id, task_name, started_at, status, message) VALUES (?, ?, ?, ?, 'queued', '任务已进入队列')")
      .bind(runId, task.id, task.name, startedAt).run();
    const transition = async (next: RunStatus, message: string) => {
      assertRunTransition(runStatus, next);
      runStatus = next;
      await db.prepare("UPDATE runs SET status=?, message=? WHERE id=?").bind(next, message.slice(0, 500), runId).run();
    };
  await transition("dispatching", "正在调度知乎连接器");
  await recordRunEvent(db, { runId, stage: "dispatch", message: "任务已进入连接器调度", metadata: { taskId: task.id } });
  const total: IngestStats = { fetched: 0, filtered: 0, deduped: 0, valid: 0, highValue: 0, timeFiltered: 0, blacklistFiltered: 0, advertisementFiltered: 0, matched: 0, analyzed: 0, failed: 0 };
  const messages: string[] = [];
  const addStats = (stats: IngestStats) => {
    for (const key of Object.keys(total) as Array<keyof IngestStats>) total[key] = (total[key] ?? 0) + (stats[key] ?? 0);
  };
  const saveSourceStats = async (source: string, stats: IngestStats, sourceStatus: string, errorCode = "", errorMessage = "") => {
    await db.prepare(`INSERT OR REPLACE INTO run_source_stats (
      run_id, source, status, discovered, time_filtered, blacklist_filtered, advertisement_filtered,
      deduped, matched, analyzed, kept, failed, started_at, finished_at, error_code, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(runId, source, sourceStatus, stats.fetched, stats.timeFiltered ?? 0, stats.blacklistFiltered ?? 0,
        stats.advertisementFiltered ?? 0, stats.deduped, stats.matched ?? 0, stats.analyzed ?? 0, stats.valid,
        stats.failed ?? 0, startedAt, new Date().toISOString(), errorCode, errorMessage.slice(0, 500)).run();
  };
  await transition("searching", "正在检索公开内容");
  await transition("collecting", "正在接收并采集候选内容");
  for (const source of parseStringArray(task.sources)) {
    await recordRunEvent(db, { runId, stage: "search", source, message: `开始处理${source}` });
    const sourceCandidates = localCandidates.filter((item) => item.source === source)
      .map((item) => ({ ...item, source }));
    if (SOCIAL_SOURCES.has(source)) {
      const localJob = localJobs[source];
      if (localJob) {
        const jobId = String(localJob.jobId ?? `local-${crypto.randomUUID()}`).slice(0, 160);
        const waitingLogin = localJob.status === "waiting_login";
        const persistedStatus = waitingLogin ? "waiting_login" : localJob.status === "failed" ? "failed" : localJob.status === "cancelled" ? "cancelled" : localJob.status === "partial" ? "partial" : localJob.status === "completed" ? "completed" : "dispatched";
        const liveViewUrl = String(localJob.liveViewUrl ?? "").startsWith("http://127.0.0.1:8765/") ? String(localJob.liveViewUrl) : "";
        const action = String(localJob.currentAction ?? `已在${source}打开关键词检索`).slice(0, 300);
        await db.prepare(`INSERT OR REPLACE INTO connector_jobs
          (id, task_id, source, status, dispatched_at, fetched, progress, current_action, phase, inspected, kept, filtered, current_item, analysis_trace, live_view_url, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(jobId, task.id, source, persistedStatus, startedAt,
            Math.max(0, Number(localJob.fetched ?? sourceCandidates.length)), Math.max(0, Math.min(100, Number(localJob.progress ?? 10))), action,
            String(localJob.phase ?? "").slice(0, 40), Math.max(0, Number(localJob.inspected ?? 0)), Math.max(0, Number(localJob.kept ?? sourceCandidates.length)),
            Math.max(0, Number(localJob.filtered ?? 0)), JSON.stringify(localJob.currentItem ?? {}), JSON.stringify((localJob.analysisTrace ?? []).slice(-40)), liveViewUrl, startedAt).run();
        const inspected = Math.max(0, Number(localJob.inspected ?? localJob.fetched ?? sourceCandidates.length));
        const prefiltered = Math.max(0, Number(localJob.prefiltered ?? 0));
        const aiFiltered = Math.max(0, Number(localJob.filtered ?? Math.max(0, inspected - sourceCandidates.length)));
        const mode = localJob.triggerMode === "background" ? "后台增量" : "单次检索";
        total.fetched += inspected + prefiltered;
        total.filtered += aiFiltered;
        if (sourceCandidates.length) {
          const stats = await ingestCandidates(db, task, sourceCandidates, { runId, source });
          addStats({ ...stats, fetched: 0 });
          await saveSourceStats(source, { ...stats, fetched: inspected + prefiltered }, persistedStatus);
          messages.push(`${source}:${mode}搜索页预过滤旧内容${prefiltered}，深读${inspected}/${localJob.targetItems ?? inspected}，AI/规则过滤${Math.max(0, aiFiltered - prefiltered) + stats.filtered}，重复${stats.deduped}，新增${stats.valid}${persistedStatus === "partial" ? `（${action}）` : ""}`);
        } else if (persistedStatus === "failed") {
          await saveSourceStats(source, { fetched: inspected + prefiltered, filtered: aiFiltered, deduped: 0, valid: 0, highValue: 0, failed: 1 }, "failed", "connector_failed", action);
          messages.push(`${source}:失败(${action})`);
        } else {
          await saveSourceStats(source, { fetched: inspected + prefiltered, filtered: aiFiltered, deduped: 0, valid: 0, highValue: 0 }, persistedStatus);
          messages.push(`${source}:${persistedStatus === "cancelled" ? "已取消" : waitingLogin ? "等待登录" : `${mode}搜索页预过滤旧内容${prefiltered}，深读${inspected}/${localJob.targetItems ?? inspected}，AI/规则过滤${Math.max(0, aiFiltered - prefiltered)}，新增0`}`);
        }
        continue;
      }
      const job = await dispatchComputerAgent({ db, task, source, callbackBase });
      await saveSourceStats(source, { fetched: 0, filtered: 0, deduped: 0, valid: 0, highValue: 0 }, job.status, job.status === "failed" ? "dispatch_failed" : "", "error" in job ? String(job.error ?? "") : "");
      messages.push(`${source}:${job.status === "dispatched" ? "已派发" : job.status === "awaiting_config" ? "等待连接电脑助手" : job.status === "disabled" ? "已停用" : "派发失败"}`);
      continue;
    }
    try {
      const items = sourceCandidates.length ? sourceCandidates : await collectPublicForum(source, task);
      const stats = await ingestCandidates(db, task, items, { runId, source });
      addStats(stats);
      await saveSourceStats(source, stats, "completed");
      messages.push(`${source}:获取${stats.fetched}/新增${stats.valid}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      total.failed = (total.failed ?? 0) + 1;
      await saveSourceStats(source, { fetched: 0, filtered: 0, deduped: 0, valid: 0, highValue: 0, failed: 1 }, "failed", "source_failed", message);
      await recordRunEvent(db, { runId, level: "error", stage: "collect", source, message: "来源处理失败", metadata: { error: message } });
      messages.push(localJobs[source]
        ? `${source}:浏览器已打开（网页直采受限）`
        : `${source}:失败(${message})`);
    }
  }
  for (const [next, message] of [
    ["normalizing", "正在标准化字段"], ["deduplicating", "正在执行全局去重"], ["prefiltering", "正在执行时间和黑名单过滤"],
    ["matching", "正在计算任务匹配"], ["analyzing", "正在校验 AI 分析与证据"], ["persisting", "正在写入线索与运行统计"],
  ] as Array<[RunStatus, string]>) await transition(next, message);
  const finishedAt = new Date().toISOString();
  const awaiting = messages.some((message) => message.includes("等待"));
  const failed = messages.some((message) => message.includes("失败"));
  const status: RunStatus = failed || awaiting || messages.some((message) => message.includes("已派发") || message.includes("已取消")) ? "partial" : "completed";
  assertRunTransition(runStatus, status);
  await db.batch([
    db.prepare("UPDATE runs SET finished_at = ?, status = ?, fetched = ?, filtered = ?, deduped = ?, valid = ?, high_value = ?, message = ? WHERE id = ?")
      .bind(finishedAt, status, total.fetched, total.filtered, total.deduped, total.valid, total.highValue, messages.join("；"), runId),
    db.prepare("UPDATE tasks SET discovered = discovered + ?, high_value = high_value + ?, last_run_at = ?, last_successful_run_at = CASE WHEN ? = 'completed' THEN ? ELSE last_successful_run_at END WHERE id = ?")
      .bind(total.valid, total.highValue, finishedAt, status, finishedAt, task.id),
    db.prepare(`INSERT INTO task_filters (task_id, schedule_enabled, next_run_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET schedule_enabled=excluded.schedule_enabled, next_run_at=excluded.next_run_at, updated_at=excluded.updated_at`)
      .bind(task.id, task.schedule === "仅手动运行" ? 0 : 1, nextScheduledAt(task.schedule), finishedAt),
  ]);
  await recordRunEvent(db, { runId, stage: "complete", level: status === "completed" ? "info" : "warning", message: status === "completed" ? "任务完成" : "任务部分完成", metadata: total });
    return { runId, status, ...total, message: messages.join("；") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "运行失败";
    const finishedAt = new Date().toISOString();
    await db.prepare("UPDATE runs SET status='failed', finished_at=?, message=? WHERE id=?")
      .bind(finishedAt, message.slice(0, 500), runId).run();
    try {
      await recordRunEvent(db, { runId, stage: "complete", level: "error", message: "任务执行失败", metadata: { error: message } });
    } catch {
      // Preserve the original pipeline error even when diagnostic persistence fails.
    }
    throw error;
  } finally {
    await db.prepare("DELETE FROM task_run_locks WHERE task_id=? AND run_id=?").bind(task.id, runId).run();
  }
}
