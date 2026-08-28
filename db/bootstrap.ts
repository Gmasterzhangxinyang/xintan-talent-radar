import { env } from "cloudflare:workers";

export type DatabaseEnv = { DB: D1Database };

export function getD1() {
  if (!env.DB) throw new Error("D1 database binding is unavailable");
  return env.DB;
}

export async function ensureDatabase() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, jd TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', sources TEXT NOT NULL DEFAULT '[]',
      tech_keywords TEXT NOT NULL DEFAULT '[]', company_keywords TEXT NOT NULL DEFAULT '[]',
      signal_keywords TEXT NOT NULL DEFAULT '[]', exclude_keywords TEXT NOT NULL DEFAULT '[]',
      schedule TEXT NOT NULL DEFAULT '每天 09:00', time_range TEXT NOT NULL DEFAULT '近30天',
      discovered INTEGER NOT NULL DEFAULT 0, high_value INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL,
      author TEXT NOT NULL, author_id TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL,
      snippet TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', intent TEXT NOT NULL DEFAULT '无',
      intelligence_type TEXT NOT NULL DEFAULT '人才线索', priority TEXT NOT NULL DEFAULT 'C',
      score INTEGER NOT NULL DEFAULT 0, company_note TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT '待审核', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_task_priority ON leads(task_id, priority)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_source_published ON leads(source, published_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, task_name TEXT NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
      fetched INTEGER NOT NULL DEFAULT 0, filtered INTEGER NOT NULL DEFAULT 0,
      deduped INTEGER NOT NULL DEFAULT 0, valid INTEGER NOT NULL DEFAULT 0,
      high_value INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_runs_task_started ON runs(task_id, started_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
      last_check TEXT NOT NULL, coverage TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS task_filters (
      task_id TEXT PRIMARY KEY, author_blacklist TEXT NOT NULL DEFAULT '[]',
      company_blacklist TEXT NOT NULL DEFAULT '[]', source_limits TEXT NOT NULL DEFAULT '{}', schedule_enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS raw_items (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL,
      external_id TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '未公开', author_id TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL, source_url TEXT NOT NULL, snippet TEXT NOT NULL,
      raw_payload TEXT NOT NULL DEFAULT '{}', fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_task_hash ON raw_items(task_id, content_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_raw_task_fetched ON raw_items(task_id, fetched_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS connector_jobs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL,
      status TEXT NOT NULL, dispatched_at TEXT NOT NULL, completed_at TEXT,
      fetched INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
      progress INTEGER NOT NULL DEFAULT 0, current_action TEXT NOT NULL DEFAULT '',
      phase TEXT NOT NULL DEFAULT '', inspected INTEGER NOT NULL DEFAULT 0,
      kept INTEGER NOT NULL DEFAULT 0, filtered INTEGER NOT NULL DEFAULT 0,
      current_item TEXT NOT NULL DEFAULT '{}', analysis_trace TEXT NOT NULL DEFAULT '[]',
      live_view_url TEXT NOT NULL DEFAULT '', screenshot_url TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_connector_jobs_task_status ON connector_jobs(task_id, status)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS connector_settings (
      id TEXT PRIMARY KEY, endpoint TEXT NOT NULL DEFAULT '', token_secret TEXT NOT NULL DEFAULT '',
      callback_secret_hash TEXT NOT NULL DEFAULT '', enabled_sources TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'not_configured', last_test_at TEXT,
      last_error TEXT NOT NULL DEFAULT '', live_view_url TEXT NOT NULL DEFAULT '',
      capabilities TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);

  // CREATE TABLE IF NOT EXISTS does not add columns introduced after the
  // database was first created. Repair older databases before task execution.
  const connectorInfo = await db.prepare("PRAGMA table_info(connector_jobs)").all<{ name: string }>();
  const connectorColumns = new Set(connectorInfo.results.map((column) => column.name));
  const missingConnectorColumns = [
    ["progress", "INTEGER NOT NULL DEFAULT 0"],
    ["current_action", "TEXT NOT NULL DEFAULT ''"],
    ["phase", "TEXT NOT NULL DEFAULT ''"],
    ["inspected", "INTEGER NOT NULL DEFAULT 0"],
    ["kept", "INTEGER NOT NULL DEFAULT 0"],
    ["filtered", "INTEGER NOT NULL DEFAULT 0"],
    ["current_item", "TEXT NOT NULL DEFAULT '{}'"],
    ["analysis_trace", "TEXT NOT NULL DEFAULT '[]'"],
    ["live_view_url", "TEXT NOT NULL DEFAULT ''"],
    ["screenshot_url", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, definition] of missingConnectorColumns) {
    if (!connectorColumns.has(name)) await db.prepare(`ALTER TABLE connector_jobs ADD COLUMN ${name} ${definition}`).run();
  }
  const filterInfo = await db.prepare("PRAGMA table_info(task_filters)").all<{ name: string }>();
  if (!filterInfo.results.some((column) => column.name === "source_limits")) {
    await db.prepare("ALTER TABLE task_filters ADD COLUMN source_limits TEXT NOT NULL DEFAULT '{}'").run();
  }

  // Version 1 is deliberately Zhihu-only. Remove legacy demo/platform rows,
  // preserve genuine Zhihu results, and normalize every existing task.
  await db.batch([
    db.prepare("DELETE FROM sources WHERE name <> '知乎'"),
    db.prepare("DELETE FROM leads WHERE source <> '知乎' OR id IN ('lead-1','lead-3','lead-4','lead-5','lead-6')"),
    db.prepare("DELETE FROM raw_items WHERE source <> '知乎'"),
    db.prepare("DELETE FROM connector_jobs WHERE source <> '知乎'"),
    db.prepare("DELETE FROM runs WHERE id IN ('run-1','run-2','run-3')"),
    db.prepare(`UPDATE tasks SET sources = '["知乎"]'`),
    db.prepare(`UPDATE connector_settings SET enabled_sources = '["知乎"]'`),
    db.prepare(`INSERT OR REPLACE INTO sources (id, name, mode, status, last_check, coverage, note) VALUES ('zhihu', '知乎', '本机浏览器 Agent', '待检测', '未执行', '公开问答、文章与评论', '复用本机知乎登录状态；逐条打开详情并由AI评估')`),
    db.prepare(`UPDATE tasks SET discovered = (SELECT COUNT(*) FROM leads WHERE leads.task_id = tasks.id), high_value = (SELECT COUNT(*) FROM leads WHERE leads.task_id = tasks.id AND leads.priority = 'A')`),
    db.prepare(`UPDATE task_filters SET source_limits = json_object('知乎', COALESCE(json_extract(source_limits, '$.知乎'), 10))`),
    db.prepare(`INSERT INTO task_filters (task_id, author_blacklist, company_blacklist, source_limits, schedule_enabled, next_run_at, updated_at)
      SELECT id, '[]', '[]', json_object('知乎', 10), CASE WHEN schedule = '仅手动运行' THEN 0 ELSE 1 END,
        CASE WHEN schedule = '仅手动运行' THEN NULL ELSE datetime('now', '+1 day') END, datetime('now')
      FROM tasks WHERE NOT EXISTS (SELECT 1 FROM task_filters WHERE task_filters.task_id = tasks.id)`),
  ]);

  const taskCount = await db.prepare("SELECT COUNT(*) AS count FROM tasks").first<{ count: number }>();
  if ((taskCount?.count ?? 0) > 0) return;

  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("task-gpu", "GPU数字验证工程师", "上海GPU数字验证工程师，5年以上经验，熟悉UVM、SystemVerilog、VCS、Verdi，有SoC流片经验。", "active", JSON.stringify(["知乎"]), JSON.stringify(["UVM", "SystemVerilog", "VCS", "Verdi", "SoC验证"]), JSON.stringify(["壁仞", "燧原", "沐曦"]), JSON.stringify(["看机会", "准备离职", "部门调整", "项目被砍"]), JSON.stringify(["培训", "课程", "招生", "广告"]), "每天 09:00", "近30天", 0, 0, null, now),
    db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("task-pd", "先进工艺数字后端", "数字后端工程师，7nm及以下工艺，熟悉Innovus、PrimeTime、Calibre。", "active", JSON.stringify(["知乎"]), JSON.stringify(["数字后端", "Innovus", "PrimeTime", "Calibre", "STA"]), JSON.stringify(["海思", "紫光展锐", "芯原"]), JSON.stringify(["HC", "团队扩招", "项目调整"]), JSON.stringify(["外包培训", "网课"]), "每周一 10:00", "近90天", 0, 0, null, now),
    db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("task-company", "重点企业异动监控", "监控GPU、AI芯片及SoC企业的裁员、扩招、项目变动和流片问题。", "paused", JSON.stringify(["知乎"]), JSON.stringify(["GPU", "SoC", "流片", "回片", "良率"]), JSON.stringify(["壁仞", "燧原", "沐曦", "摩尔线程"]), JSON.stringify(["裁员", "扩招", "冻结HC", "流片延期", "项目暂停"]), JSON.stringify(["媒体转载", "广告"]), "每天 18:00", "近7天", 0, 0, null, now),
    db.prepare("INSERT OR REPLACE INTO sources VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("zhihu", "知乎", "本机浏览器 Agent", "待检测", "未执行", "公开问答、文章与评论", "复用本机知乎登录状态；逐条打开详情并由AI评估"),
  ]);
}
