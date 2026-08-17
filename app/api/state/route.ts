import { ensureDatabase, getD1 } from "../../../db/bootstrap";

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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

export async function GET() {
  try {
    await ensureDatabase();
    const db = getD1();
    const [taskRows, leadRows, runRows, sourceRows] = await Promise.all([
      db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all(),
      db.prepare("SELECT * FROM leads ORDER BY score DESC, published_at DESC").all(),
      db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 30").all(),
      db.prepare("SELECT * FROM sources ORDER BY name").all(),
    ]);

    return Response.json({
      tasks: taskRows.results.map((row) => normalizeTask(row as Record<string, unknown>)),
      leads: leadRows.results.map((row) => normalizeLead(row as Record<string, unknown>)),
      runs: runRows.results.map((row) => normalizeRun(row as Record<string, unknown>)),
      sources: sourceRows.results.map((row) => normalizeSource(row as Record<string, unknown>)),
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
      await db.prepare(`INSERT INTO tasks (
        id, name, jd, status, sources, tech_keywords, company_keywords,
        signal_keywords, exclude_keywords, schedule, time_range, discovered,
        high_value, last_run_at, created_at
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)`)
        .bind(
          id,
          String(task.name ?? "未命名任务"),
          String(task.jd ?? ""),
          JSON.stringify(task.sources ?? []),
          JSON.stringify(task.techKeywords ?? []),
          JSON.stringify(task.companyKeywords ?? []),
          JSON.stringify(task.signalKeywords ?? []),
          JSON.stringify(task.excludeKeywords ?? []),
          String(task.schedule ?? "每天 09:00"),
          String(task.timeRange ?? "近30天"),
          now,
        )
        .run();
      return Response.json({ ok: true, id });
    }

    if (action === "simulateRun") {
      const taskId = String(payload.taskId ?? "");
      const task = await db.prepare("SELECT name FROM tasks WHERE id = ?").bind(taskId).first<{ name: string }>();
      if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
      const now = new Date().toISOString();
      const runId = `run-${crypto.randomUUID()}`;
      const fetched = 186;
      const filtered = 109;
      const deduped = 31;
      const valid = 46;
      const highValue = 8;
      await db.batch([
        db.prepare("INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(runId, taskId, task.name, now, now, "完成", fetched, filtered, deduped, valid, highValue, "增量扫描完成；旧数据已通过内容指纹过滤"),
        db.prepare("UPDATE tasks SET discovered = discovered + ?, high_value = high_value + ?, last_run_at = ? WHERE id = ?")
          .bind(valid, highValue, now, taskId),
      ]);
      return Response.json({ ok: true, runId });
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
