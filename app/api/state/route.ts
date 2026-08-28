import { ensureDatabase, getD1 } from "../../../db/bootstrap";
import { parseJd } from "../../../lib/jd-parser";
import { runTask } from "../../../lib/pipeline";

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nextScheduledAt(schedule: string) {
  if (schedule === "仅手动运行") return null;
  const next = new Date();
  next.setDate(next.getDate() + (schedule.includes("每周") ? 7 : 1));
  const time = schedule.match(/(\d{1,2}):(\d{2})/);
  if (time) next.setHours(Number(time[1]), Number(time[2]), 0, 0);
  return next.toISOString();
}

function normalizeTask(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    jd: row.jd,
    status: row.status,
    sources: parseJson(row.sources, []),
    techKeywords: parseJson(row.tech_keywords, []),
    companyKeywords: parseJson(row.company_keywords, []),
    signalKeywords: parseJson(row.signal_keywords, []),
    excludeKeywords: parseJson(row.exclude_keywords, []),
    schedule: row.schedule,
    timeRange: row.time_range,
    discovered: row.discovered,
    highValue: row.high_value,
    lastRunAt: row.last_run_at,
    authorBlacklist: parseJson(row.author_blacklist, []),
    companyBlacklist: parseJson(row.company_blacklist, []),
    sourceLimits: parseJson(row.source_limits, {}),
    scheduleEnabled: row.schedule_enabled !== 0,
    nextRunAt: row.next_run_at,
  };
}

function normalizeLead(row: Record<string, unknown>) {
  return {
    id: row.id,
    taskId: row.task_id,
    source: row.source,
    author: row.author,
    authorId: row.author_id,
    publishedAt: row.published_at,
    snippet: row.snippet,
    tags: parseJson(row.tags, []),
    intent: row.intent,
    intelligenceType: row.intelligence_type,
    priority: row.priority,
    score: row.score,
    companyNote: row.company_note,
    evidence: row.evidence,
    url: row.url,
    reviewStatus: row.review_status,
  };
}

function normalizeRun(row: Record<string, unknown>) {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    fetched: row.fetched,
    filtered: row.filtered,
    deduped: row.deduped,
    valid: row.valid,
    highValue: row.high_value,
    message: row.message,
  };
}

function normalizeSource(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    status: row.status,
    lastCheck: row.last_check,
    coverage: row.coverage,
    note: row.note,
  };
}

function normalizeConnectorJob(row: Record<string, unknown>) {
  return {
    id: row.id, taskId: row.task_id, source: row.source, status: row.status,
    dispatchedAt: row.dispatched_at, completedAt: row.completed_at,
    fetched: row.fetched, error: row.error, progress: row.progress,
    currentAction: row.current_action, liveViewUrl: row.live_view_url,
    screenshotUrl: row.screenshot_url, updatedAt: row.updated_at,
    phase: row.phase, inspected: row.inspected, kept: row.kept, filtered: row.filtered,
    currentItem: parseJson(row.current_item, null), analysisTrace: parseJson(row.analysis_trace, []),
  };
}

export async function GET() {
  try {
    await ensureDatabase();
    const db = getD1();
    const [taskRows, leadRows, runRows, sourceRows, connectorRows] = await Promise.all([
      db.prepare("SELECT t.*, f.author_blacklist, f.company_blacklist, f.source_limits, f.schedule_enabled, f.next_run_at FROM tasks t LEFT JOIN task_filters f ON f.task_id=t.id ORDER BY t.created_at DESC").all(),
      db.prepare("SELECT * FROM leads ORDER BY score DESC, published_at DESC").all(),
      db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 30").all(),
      db.prepare("SELECT * FROM sources ORDER BY name").all(),
      db.prepare("SELECT * FROM connector_jobs ORDER BY dispatched_at DESC LIMIT 50").all(),
    ]);

    return Response.json({
      tasks: taskRows.results.map((row) => normalizeTask(row as Record<string, unknown>)),
      leads: leadRows.results.map((row) => normalizeLead(row as Record<string, unknown>)),
      runs: runRows.results.map((row) => normalizeRun(row as Record<string, unknown>)),
      sources: sourceRows.results.map((row) => normalizeSource(row as Record<string, unknown>)),
      connectorJobs: connectorRows.results.map((row) => normalizeConnectorJob(row as Record<string, unknown>)),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "加载数据失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const db = getD1();
    const payload = (await request.json()) as Record<string, unknown>;
    const action = String(payload.action ?? "");

    if (action === "createTask") {
      const task = payload.task as Record<string, unknown>;
      const id = `task-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await db.batch([db.prepare(`INSERT INTO tasks (
        id, name, jd, status, sources, tech_keywords, company_keywords,
        signal_keywords, exclude_keywords, schedule, time_range, discovered,
        high_value, last_run_at, created_at
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)`)
        .bind(
          id,
          String(task.name ?? "未命名任务"),
          String(task.jd ?? ""),
          JSON.stringify(["知乎"]),
          JSON.stringify(task.techKeywords ?? []),
          JSON.stringify(task.companyKeywords ?? []),
          JSON.stringify(task.signalKeywords ?? []),
          JSON.stringify(task.excludeKeywords ?? []),
          String(task.schedule ?? "仅手动运行"),
          String(task.timeRange ?? "近30天"),
          now,
        )
        ,
        db.prepare("INSERT OR REPLACE INTO task_filters (task_id, author_blacklist, company_blacklist, source_limits, schedule_enabled, next_run_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, JSON.stringify(task.authorBlacklist ?? []), JSON.stringify(task.companyBlacklist ?? []), JSON.stringify({ 知乎: Math.max(1, Math.min(50, Number((task.sourceLimits as Record<string, unknown> | undefined)?.知乎 ?? 10))) }), task.scheduleEnabled === false ? 0 : 1, task.scheduleEnabled === false ? null : nextScheduledAt(String(task.schedule ?? "仅手动运行")), now),
      ]);
      return Response.json({ ok: true, id });
    }

    if (action === "analyzeJd") {
      return Response.json(parseJd(String(payload.jd ?? "")));
    }

    if (action === "runTask") {
      const taskId = String(payload.taskId ?? "");
      const origin = new URL(request.url).origin;
      const localJobs = payload.localJobs && typeof payload.localJobs === "object"
        ? payload.localJobs as Record<string, { jobId?: string; status?: string; phase?: string; progress?: number; fetched?: number; inspected?: number; kept?: number; filtered?: number; prefiltered?: number; targetItems?: number; triggerMode?: string; currentAction?: string; currentItem?: unknown; analysisTrace?: unknown[]; liveViewUrl?: string }>
        : {};
      const localCandidates = Array.isArray(payload.localCandidates) ? payload.localCandidates.slice(0, 300).map((item) => {
        const candidate = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          source: String(candidate.source ?? "").slice(0, 40), externalId: String(candidate.externalId ?? "").slice(0, 1_000),
          author: String(candidate.author ?? "公开用户").slice(0, 160), authorId: String(candidate.authorId ?? "").slice(0, 160),
          publishedAt: String(candidate.publishedAt ?? "未公开").slice(0, 80), snippet: String(candidate.snippet ?? "").slice(0, 5_000),
          url: String(candidate.url ?? "").slice(0, 2_000),
          raw: candidate.raw && typeof candidate.raw === "object" ? candidate.raw : {},
        };
      }) : [];
      return Response.json({ ok: true, ...(await runTask(db, taskId, origin, localJobs, localCandidates)) });
    }

    if (action === "updateTask") {
      const task = payload.task as Record<string, unknown>;
      const id = String(task.id ?? "");
      if (!id) return Response.json({ error: "缺少任务ID" }, { status: 400 });
      await db.batch([
        db.prepare(`UPDATE tasks SET name=?, jd=?, status=?, sources=?, tech_keywords=?, company_keywords=?, signal_keywords=?, exclude_keywords=?, schedule=?, time_range=? WHERE id=?`)
          .bind(String(task.name ?? "未命名任务"), String(task.jd ?? ""), String(task.status ?? "active"), JSON.stringify(["知乎"]),
            JSON.stringify(task.techKeywords ?? []), JSON.stringify(task.companyKeywords ?? []), JSON.stringify(task.signalKeywords ?? []),
            JSON.stringify(task.excludeKeywords ?? []), String(task.schedule ?? "仅手动运行"), String(task.timeRange ?? "近30天"), id),
        db.prepare("INSERT OR REPLACE INTO task_filters (task_id, author_blacklist, company_blacklist, source_limits, schedule_enabled, next_run_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, JSON.stringify(task.authorBlacklist ?? []), JSON.stringify(task.companyBlacklist ?? []), JSON.stringify({ 知乎: Math.max(1, Math.min(50, Number((task.sourceLimits as Record<string, unknown> | undefined)?.知乎 ?? 10))) }), task.scheduleEnabled === false ? 0 : 1, task.scheduleEnabled === false ? null : nextScheduledAt(String(task.schedule ?? "仅手动运行")), new Date().toISOString()),
      ]);
      return Response.json({ ok: true });
    }

    if (action === "toggleTask") {
      const taskId = String(payload.taskId ?? "");
      const status = String(payload.status ?? "paused") === "active" ? "active" : "paused";
      await db.prepare("UPDATE tasks SET status = ? WHERE id = ?").bind(status, taskId).run();
      return Response.json({ ok: true });
    }

    if (action === "deleteTask") {
      const taskId = String(payload.taskId ?? "");
      await db.batch([
        db.prepare("DELETE FROM connector_jobs WHERE task_id = ?").bind(taskId),
        db.prepare("DELETE FROM raw_items WHERE task_id = ?").bind(taskId),
        db.prepare("DELETE FROM task_filters WHERE task_id = ?").bind(taskId),
        db.prepare("DELETE FROM leads WHERE task_id = ?").bind(taskId),
        db.prepare("DELETE FROM runs WHERE task_id = ?").bind(taskId),
        db.prepare("DELETE FROM tasks WHERE id = ?").bind(taskId),
      ]);
      return Response.json({ ok: true });
    }

    if (action === "reviewLead") {
      const leadId = String(payload.leadId ?? "");
      const reviewStatus = String(payload.reviewStatus ?? "待审核");
      await db.prepare("UPDATE leads SET review_status = ? WHERE id = ?")
        .bind(reviewStatus, leadId)
        .run();
      return Response.json({ ok: true });
    }

    return Response.json({ error: "未知操作" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "操作失败" },
      { status: 500 },
    );
  }
}
