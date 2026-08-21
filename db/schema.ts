import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    jd: text("jd").notNull().default(""),
    status: text("status").notNull().default("active"),
    sources: text("sources").notNull().default("[]"),
    techKeywords: text("tech_keywords").notNull().default("[]"),
    companyKeywords: text("company_keywords").notNull().default("[]"),
    signalKeywords: text("signal_keywords").notNull().default("[]"),
    excludeKeywords: text("exclude_keywords").notNull().default("[]"),
    schedule: text("schedule").notNull().default("每天 09:00"),
    timeRange: text("time_range").notNull().default("近30天"),
    discovered: integer("discovered").notNull().default(0),
    highValue: integer("high_value").notNull().default(0),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_tasks_status_created").on(table.status, table.createdAt),
  ],
);

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    source: text("source").notNull(),
    author: text("author").notNull(),
    authorId: text("author_id").notNull().default(""),
    publishedAt: text("published_at").notNull(),
    snippet: text("snippet").notNull(),
    tags: text("tags").notNull().default("[]"),
    intent: text("intent").notNull().default("无"),
    intelligenceType: text("intelligence_type").notNull().default("人才线索"),
    priority: text("priority").notNull().default("C"),
    score: integer("score").notNull().default(0),
    companyNote: text("company_note").notNull().default(""),
    evidence: text("evidence").notNull().default(""),
    url: text("url").notNull(),
    reviewStatus: text("review_status").notNull().default("待审核"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_leads_task_priority").on(table.taskId, table.priority),
    index("idx_leads_source_published").on(table.source, table.publishedAt),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    taskName: text("task_name").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status").notNull(),
    fetched: integer("fetched").notNull().default(0),
    filtered: integer("filtered").notNull().default(0),
    deduped: integer("deduped").notNull().default(0),
    valid: integer("valid").notNull().default(0),
    highValue: integer("high_value").notNull().default(0),
    message: text("message").notNull().default(""),
  },
  (table) => [index("idx_runs_task_started").on(table.taskId, table.startedAt)],
);

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  lastCheck: text("last_check").notNull(),
  coverage: text("coverage").notNull(),
  note: text("note").notNull().default(""),
});

export const taskFilters = sqliteTable("task_filters", {
  taskId: text("task_id").primaryKey(),
  authorBlacklist: text("author_blacklist").notNull().default("[]"),
  companyBlacklist: text("company_blacklist").notNull().default("[]"),
  sourceLimits: text("source_limits").notNull().default("{}"),
  scheduleEnabled: integer("schedule_enabled").notNull().default(1),
  nextRunAt: text("next_run_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rawItems = sqliteTable(
  "raw_items",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull().default(""),
    contentHash: text("content_hash").notNull(),
    author: text("author").notNull().default("未公开"),
    authorId: text("author_id").notNull().default(""),
    publishedAt: text("published_at").notNull(),
    sourceUrl: text("source_url").notNull(),
    snippet: text("snippet").notNull(),
    rawPayload: text("raw_payload").notNull().default("{}"),
    fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("uq_raw_task_hash").on(table.taskId, table.contentHash),
    index("idx_raw_task_fetched").on(table.taskId, table.fetchedAt),
  ],
);

export const connectorJobs = sqliteTable(
  "connector_jobs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    dispatchedAt: text("dispatched_at").notNull(),
    completedAt: text("completed_at"),
    fetched: integer("fetched").notNull().default(0),
    error: text("error").notNull().default(""),
    progress: integer("progress").notNull().default(0),
    currentAction: text("current_action").notNull().default(""),
    phase: text("phase").notNull().default(""),
    inspected: integer("inspected").notNull().default(0),
    kept: integer("kept").notNull().default(0),
    filtered: integer("filtered").notNull().default(0),
    currentItem: text("current_item").notNull().default("{}"),
    analysisTrace: text("analysis_trace").notNull().default("[]"),
    liveViewUrl: text("live_view_url").notNull().default(""),
    screenshotUrl: text("screenshot_url").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_connector_jobs_task_status").on(table.taskId, table.status)],
);

export const connectorSettings = sqliteTable("connector_settings", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull().default(""),
  tokenSecret: text("token_secret").notNull().default(""),
  callbackSecretHash: text("callback_secret_hash").notNull().default(""),
  enabledSources: text("enabled_sources").notNull().default("[]"),
  status: text("status").notNull().default("not_configured"),
  lastTestAt: text("last_test_at"),
  lastError: text("last_error").notNull().default(""),
  liveViewUrl: text("live_view_url").notNull().default(""),
  capabilities: text("capabilities").notNull().default("[]"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
