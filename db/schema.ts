import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
