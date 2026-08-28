import { env } from "cloudflare:workers";

export type DatabaseEnv = { DB: D1Database };

export function getD1() {
  if (!env.DB) throw new Error("D1 database binding is unavailable");
  return env.DB;
}

export async function ensureDatabase() {
  const db = getD1();

  async function tableExists(table: string) {
    const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
    return Boolean(row);
  }

  async function addMissingColumns(table: string, definitions: ReadonlyArray<readonly [string, string]>) {
    if (!(await tableExists(table))) return;
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const columns = new Set(info.results.map((column) => column.name));
    for (const [name, definition] of definitions) {
      if (!columns.has(name)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    }
  }

  // Older local installations predate the global content model. Repair their
  // shape before creating indexes that reference the new columns. The legacy
  // table is intentionally retained as a recoverable migration backup.
  await addMissingColumns("tasks", [
    ["role_family", "TEXT"], ["locations", "TEXT NOT NULL DEFAULT '[]'"], ["seniority", "TEXT NOT NULL DEFAULT ''"],
    ["query_groups", "TEXT NOT NULL DEFAULT '[]'"], ["analysis_profile_id", "TEXT"], ["scan_mode", "TEXT NOT NULL DEFAULT 'manual'"],
    ["last_successful_run_at", "TEXT"], ["version", "INTEGER NOT NULL DEFAULT 1"],
  ]);
  await addMissingColumns("leads", [
    ["raw_item_id", "TEXT"], ["analysis_id", "TEXT"], ["lead_type", "TEXT NOT NULL DEFAULT 'uncertain'"],
    ["job_match_score", "INTEGER NOT NULL DEFAULT 0"], ["intent_score", "INTEGER NOT NULL DEFAULT 0"],
    ["intel_score", "INTEGER NOT NULL DEFAULT 0"], ["identity_confidence", "REAL NOT NULL DEFAULT 0"],
    ["evidence_confidence", "REAL NOT NULL DEFAULT 0"], ["overall_score", "INTEGER NOT NULL DEFAULT 0"],
    ["review_note", "TEXT NOT NULL DEFAULT ''"], ["reviewed_by", "TEXT NOT NULL DEFAULT ''"], ["reviewed_at", "TEXT"],
  ]);

  let legacyRawTable = "";
  if (await tableExists("raw_items")) {
    const rawInfo = await db.prepare("PRAGMA table_info(raw_items)").all<{ name: string }>();
    const rawColumns = new Set(rawInfo.results.map((column) => column.name));
    if (rawColumns.has("source_url") && !rawColumns.has("canonical_url")) {
      legacyRawTable = "legacy_raw_items_runtime";
      if (!(await tableExists(legacyRawTable))) await db.prepare(`ALTER TABLE raw_items RENAME TO ${legacyRawTable}`).run();
    }
  }
  if (!legacyRawTable && await tableExists("legacy_raw_items_runtime")) legacyRawTable = "legacy_raw_items_runtime";
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, jd TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', sources TEXT NOT NULL DEFAULT '[]',
      tech_keywords TEXT NOT NULL DEFAULT '[]', company_keywords TEXT NOT NULL DEFAULT '[]',
      signal_keywords TEXT NOT NULL DEFAULT '[]', exclude_keywords TEXT NOT NULL DEFAULT '[]',
      schedule TEXT NOT NULL DEFAULT '每天 09:00', time_range TEXT NOT NULL DEFAULT '近30天',
      role_family TEXT, locations TEXT NOT NULL DEFAULT '[]', seniority TEXT NOT NULL DEFAULT '',
      query_groups TEXT NOT NULL DEFAULT '[]', analysis_profile_id TEXT,
      scan_mode TEXT NOT NULL DEFAULT 'manual', last_successful_run_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      discovered INTEGER NOT NULL DEFAULT 0, high_value INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, raw_item_id TEXT, analysis_id TEXT,
      lead_type TEXT NOT NULL DEFAULT 'uncertain', source TEXT NOT NULL,
      author TEXT NOT NULL, author_id TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL,
      snippet TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', intent TEXT NOT NULL DEFAULT '无',
      intelligence_type TEXT NOT NULL DEFAULT '人才线索', priority TEXT NOT NULL DEFAULT 'C',
      score INTEGER NOT NULL DEFAULT 0, job_match_score INTEGER NOT NULL DEFAULT 0,
      intent_score INTEGER NOT NULL DEFAULT 0, intel_score INTEGER NOT NULL DEFAULT 0,
      identity_confidence REAL NOT NULL DEFAULT 0, evidence_confidence REAL NOT NULL DEFAULT 0,
      overall_score INTEGER NOT NULL DEFAULT 0, company_note TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending', review_note TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_task_priority ON leads(task_id, priority)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_source_published ON leads(source, published_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_review_created ON leads(review_status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_raw_item ON leads(raw_item_id)"),
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
      id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL DEFAULT '',
      canonical_url TEXT NOT NULL, content_hash TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '未公开', author_id TEXT NOT NULL DEFAULT '',
      author_profile_url TEXT NOT NULL DEFAULT '', published_at TEXT,
      published_at_raw TEXT NOT NULL DEFAULT '', time_confidence TEXT NOT NULL DEFAULT 'unknown',
      title TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL, full_text TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'post', raw_payload TEXT NOT NULL DEFAULT '{}',
      fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_source_url ON raw_items(source, canonical_url)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_raw_source_external ON raw_items(source, external_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_raw_content_hash ON raw_items(content_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_raw_source_published ON raw_items(source, published_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS task_item_matches (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, raw_item_id TEXT NOT NULL,
      matched_keywords TEXT NOT NULL DEFAULT '[]', match_score INTEGER NOT NULL DEFAULT 0,
      match_reason TEXT NOT NULL DEFAULT '', first_matched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_matched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_task_item_match ON task_item_matches(task_id, raw_item_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_task_matches_raw ON task_item_matches(raw_item_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY, raw_item_id TEXT NOT NULL, model TEXT NOT NULL,
      prompt_version TEXT NOT NULL, taxonomy_version TEXT NOT NULL, intelligence_type TEXT NOT NULL,
      job_match_score INTEGER NOT NULL DEFAULT 0, job_intent_score INTEGER NOT NULL DEFAULT 0,
      company_intel_score INTEGER NOT NULL DEFAULT 0, identity_confidence REAL NOT NULL DEFAULT 0,
      evidence_confidence REAL NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]',
      evidence_quotes TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT '',
      uncertainty TEXT NOT NULL DEFAULT '[]', raw_output TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL, error_code TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_analyses_raw_status_created ON analyses(raw_item_id, status, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS run_source_stats (
      run_id TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL,
      discovered INTEGER NOT NULL DEFAULT 0, time_filtered INTEGER NOT NULL DEFAULT 0,
      blacklist_filtered INTEGER NOT NULL DEFAULT 0, advertisement_filtered INTEGER NOT NULL DEFAULT 0,
      deduped INTEGER NOT NULL DEFAULT 0, matched INTEGER NOT NULL DEFAULT 0,
      analyzed INTEGER NOT NULL DEFAULT 0, kept INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT,
      error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_run_source_stats ON run_source_stats(run_id, source)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, level TEXT NOT NULL, stage TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_run_events_run_created ON run_events(run_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, file_name TEXT NOT NULL DEFAULT '', format TEXT NOT NULL,
      status TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0,
      duplicated INTEGER NOT NULL DEFAULT 0, filtered INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_import_batches_task_created ON import_batches(task_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS import_rows (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, row_number INTEGER NOT NULL, status TEXT NOT NULL,
      error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '', raw_item_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_import_rows_batch_row ON import_rows(batch_id, row_number)"),
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

  if (legacyRawTable) {
    await db.prepare(`INSERT OR IGNORE INTO raw_items (
      id, source, external_id, canonical_url, content_hash, author, author_id,
      published_at, published_at_raw, time_confidence, snippet, full_text,
      raw_payload, fetched_at, updated_at
    )
    SELECT id, source, external_id, source_url, content_hash, author, author_id,
      CASE WHEN published_at = '未公开' THEN NULL ELSE published_at END,
      published_at, CASE WHEN published_at = '未公开' THEN 'unknown' ELSE 'medium' END,
      snippet, snippet, raw_payload, fetched_at, fetched_at
    FROM (
      SELECT legacy_raw_items_runtime.*,
        ROW_NUMBER() OVER (PARTITION BY source, source_url ORDER BY fetched_at DESC, id ASC) AS row_number
      FROM legacy_raw_items_runtime
    ) WHERE row_number = 1`).run();
    await db.prepare(`INSERT OR IGNORE INTO task_item_matches (
      id, task_id, raw_item_id, match_reason, first_matched_at, last_matched_at
    )
    SELECT 'match-' || l.id, l.task_id, r.id, '旧数据自动迁移', l.fetched_at, l.fetched_at
    FROM legacy_raw_items_runtime l
    JOIN raw_items r ON r.source=l.source AND r.canonical_url=l.source_url`).run();
    await db.prepare(`UPDATE leads SET raw_item_id=(
      SELECT r.id FROM raw_items r
      JOIN legacy_raw_items_runtime l ON l.source=r.source AND l.source_url=r.canonical_url
      WHERE l.task_id=leads.task_id AND l.source=leads.source AND l.source_url=leads.url LIMIT 1
    ) WHERE raw_item_id IS NULL`).run();
  }
  await db.prepare(`UPDATE leads SET
    lead_type=CASE intelligence_type WHEN '人才线索' THEN 'talent' WHEN '企业情报' THEN 'company_intelligence' ELSE lead_type END,
    job_match_score=CASE WHEN intelligence_type='人才线索' AND job_match_score=0 THEN score ELSE job_match_score END,
    intent_score=CASE WHEN intent_score=0 THEN CASE intent WHEN '强' THEN 85 WHEN '中' THEN 55 ELSE 0 END ELSE intent_score END,
    intel_score=CASE WHEN intelligence_type='企业情报' AND intel_score=0 THEN score ELSE intel_score END,
    overall_score=CASE WHEN overall_score=0 THEN score ELSE overall_score END,
    review_status=CASE review_status WHEN '已确认' THEN 'confirmed' WHEN '误报' THEN 'false_positive' WHEN '待审核' THEN 'pending' ELSE review_status END`).run();

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
  await db.prepare(`INSERT OR IGNORE INTO sources (id, name, mode, status, last_check, coverage, note)
    VALUES ('zhihu', '知乎', '本机浏览器 Agent', '待检测', '未执行', '公开问答、文章与评论', '复用本机知乎登录状态；逐条打开详情并由AI评估')`).run();

  // A new production database intentionally starts with no tasks or leads.
  // Users create tasks from their own JD; fixtures belong only in tests.
}
