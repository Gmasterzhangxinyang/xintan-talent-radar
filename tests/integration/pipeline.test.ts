import assert from "node:assert/strict";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ingestCandidates } from "../../lib/pipeline/ingest";
import { runTask } from "../../lib/pipeline";
import type { CandidateItem, TaskRecord } from "../../lib/types";

class TestStatement {
  constructor(private statement: StatementSync, private values: unknown[] = []) {}
  bind(...values: unknown[]) { return new TestStatement(this.statement, values); }
  async first<T>() { return (this.statement.get(...this.values) as T | undefined) ?? null; }
  async all<T>() { return { results: this.statement.all(...this.values) as T[] }; }
  async run() { const result = this.statement.run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
}

class TestDatabase {
  constructor(private database: DatabaseSync) {}
  prepare(sql: string) { return new TestStatement(this.database.prepare(sql)); }
  async batch(statements: TestStatement[]) { return Promise.all(statements.map((statement) => statement.run())); }
}

const migrations = [
  "0000_same_agent_zero.sql", "0001_seed-validation-data.sql", "0002_backend_pipeline.sql",
  "0003_connector_truth.sql", "0004_connector_settings.sql", "0005_remove_eetop.sql",
  "0006_analysis_audit.sql", "0007_source_deep_read_limits.sql", "0008_zhihu_only.sql",
  "0009_remove_legacy_seed_data.sql", "0010_global_content_and_analysis.sql", "0011_import_batches.sql", "0012_run_locks.sql",
  "0013_analysis_request_audit.sql",
];

function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const project = resolve(import.meta.dirname, "../..");
  for (const migration of migrations) sqlite.exec(readFileSync(resolve(project, "drizzle", migration), "utf8"));
  return { sqlite, d1: new TestDatabase(sqlite) as unknown as D1Database };
}

function task(id: string): TaskRecord {
  return {
    id, name: id, jd: "", status: "active", sources: '["知乎"]', tech_keywords: '["UVM","VCS"]',
    company_keywords: "[]", signal_keywords: '["考虑机会"]', exclude_keywords: '["培训"]', schedule: "仅手动运行",
    time_range: "近30天",
  };
}

function candidate(url = "https://www.zhihu.com/question/100"): CandidateItem {
  const snippet = "做过 UVM 和 VCS 验证，项目收尾后正在考虑机会。";
  return {
    source: "知乎", externalId: url, author: "公开作者", authorId: "public-1",
    publishedAt: new Date().toISOString(), snippet, fullText: snippet, contentType: "answer", url,
    raw: { aiAnalysis: {
      tags: ["UVM", "VCS"], intent: "中", intelligenceType: "人才线索", score: 76,
      reasoningSummary: "技术经历匹配且存在弱机会意向", evidenceQuotes: ["正在考虑机会"], confidence: 0.9,
      model: "test-structured-model", responseId: "resp-test", latencyMs: 432, retryCount: 1,
    } },
  };
}

test("stores one global item, links multiple tasks and remains idempotent", async () => {
  const { sqlite, d1 } = createDatabase();
  sqlite.exec(`INSERT INTO task_filters (task_id, author_blacklist, company_blacklist) VALUES ('task-a','[]','[]'),('task-b','[]','[]')`);

  const first = await ingestCandidates(d1, task("task-a"), [candidate()]);
  const secondTask = await ingestCandidates(d1, task("task-b"), [candidate("https://www.zhihu.com/question/100?utm_source=share")]);
  const repeated = await ingestCandidates(d1, task("task-a"), [candidate()]);

  assert.equal(first.valid, 1);
  assert.equal(secondTask.valid, 1);
  assert.equal(repeated.deduped, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM raw_items").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM task_item_matches").get().count, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM leads").get().count, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM analyses WHERE status='success'").get().count, 2);
  const audit = sqlite.prepare("SELECT response_id, latency_ms, retry_count FROM analyses WHERE status='success' LIMIT 1").get();
  assert.equal(audit.response_id, "resp-test");
  assert.equal(audit.latency_ms, 432);
  assert.equal(audit.retry_count, 1);
});

test("records an explicit failed analysis and never creates a fallback lead", async () => {
  const { sqlite, d1 } = createDatabase();
  sqlite.exec(`INSERT INTO task_filters (task_id, author_blacklist, company_blacklist) VALUES ('task-a','[]','[]')`);
  const withoutAi = candidate("https://www.zhihu.com/question/101");
  withoutAi.raw = {};

  const result = await ingestCandidates(d1, task("task-a"), [withoutAi]);

  assert.equal(result.valid, 0);
  assert.equal(result.failed, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM leads").get().count, 0);
  const analysis = sqlite.prepare("SELECT status, error_code FROM analyses").get();
  assert.equal(analysis.status, "analysis_failed");
  assert.equal(analysis.error_code, "missing_ai_analysis");
});

test("rejects invented strong-intent evidence before lead persistence", async () => {
  const { sqlite, d1 } = createDatabase();
  sqlite.exec(`INSERT INTO task_filters (task_id, author_blacklist, company_blacklist) VALUES ('task-a','[]','[]')`);
  const invalid = candidate("https://www.zhihu.com/question/102");
  invalid.raw = { aiAnalysis: {
    tags: ["UVM"], intent: "强", intelligenceType: "人才线索", score: 95,
    evidenceQuotes: ["我已经正式提交离职"], confidence: 0.98, model: "test-structured-model",
  } };

  const result = await ingestCandidates(d1, task("task-a"), [invalid]);

  assert.equal(result.valid, 0);
  assert.equal(sqlite.prepare("SELECT status FROM analyses").get().status, "invalid_evidence");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM leads").get().count, 0);
});

test("stores combined talent and company intelligence without letting the model set final priority", async () => {
  const { sqlite, d1 } = createDatabase();
  sqlite.exec(`INSERT INTO task_filters (task_id, author_blacklist, company_blacklist) VALUES ('task-a','[]','[]')`);
  const both = candidate("https://www.zhihu.com/question/103");
  both.raw = { aiAnalysis: {
    contentType: "both", tags: ["UVM", "项目调整"], intent: "中", intelligenceType: "企业情报",
    companyIntelligenceType: "project_change", jobMatchScore: 82, intentScore: 58, companyIntelScore: 72,
    identityConfidence: 0.76, evidenceConfidence: 0.91, evidenceQuotes: ["项目收尾后正在考虑机会"],
    reasoningSummary: "项目收尾且作者正在考虑机会", uncertainty: [], recommendedAction: "human_review",
    score: 99, priority: "A", confidence: 0.91, model: "test-structured-model",
  } };

  const result = await ingestCandidates(d1, task("task-a"), [both]);

  assert.equal(result.valid, 1);
  const lead = sqlite.prepare("SELECT lead_type, intelligence_type, job_match_score, intel_score, priority FROM leads").get();
  assert.equal(lead.lead_type, "both");
  assert.equal(lead.intelligence_type, "人才与企业情报");
  assert.equal(lead.job_match_score, 82);
  assert.equal(lead.intel_score, 72);
  assert.notEqual(lead.priority, "A", "model-provided priority must not override deterministic scoring");
});

test("keeps recruitment ads in the analysis audit but does not create a lead", async () => {
  const { sqlite, d1 } = createDatabase();
  sqlite.exec(`INSERT INTO task_filters (task_id, author_blacklist, company_blacklist) VALUES ('task-a','[]','[]')`);
  const ad = candidate("https://www.zhihu.com/question/104");
  ad.raw = { aiAnalysis: {
    contentType: "recruitment_ad", tags: ["招聘"], intent: "无", intelligenceType: "无效内容",
    evidenceQuotes: [], confidence: 0.95, score: 95, model: "test-structured-model",
  } };

  const result = await ingestCandidates(d1, task("task-a"), [ad]);

  assert.equal(result.valid, 0);
  assert.equal(result.filtered, 1);
  assert.equal(sqlite.prepare("SELECT status FROM analyses").get().status, "filtered_content");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM leads").get().count, 0);
});

test("runs the explicit state machine, writes its funnel and always releases the task lock", async () => {
  const { sqlite, d1 } = createDatabase();
  sqlite.exec(`INSERT INTO tasks (id,name,jd,status,sources,tech_keywords,company_keywords,signal_keywords,exclude_keywords,schedule,time_range)
    VALUES ('task-a','验证任务','','active','["知乎"]','["UVM","VCS"]','[]','["考虑机会"]','["培训"]','仅手动运行','近30天');
    INSERT INTO task_filters (task_id, author_blacklist, company_blacklist, source_limits) VALUES ('task-a','[]','[]','{"知乎":1}');`);

  const result = await runTask(d1, "task-a", "https://example.test", {
    知乎: { jobId: "local-test", status: "completed", progress: 100, fetched: 1, inspected: 1, kept: 1, filtered: 0, prefiltered: 0, targetItems: 1, currentAction: "测试完成" },
  }, [candidate("https://www.zhihu.com/question/105")]);

  assert.equal(result.status, "completed");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM task_run_locks").get()?.count, 0);
  assert.equal(sqlite.prepare("SELECT status FROM runs").get()?.status, "completed");
  assert.equal(sqlite.prepare("SELECT discovered, analyzed, kept FROM run_source_stats").get()?.kept, 1);
  assert.ok(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM run_events").get()?.count) >= 3);
});

test("returns the existing run id when the same task is already locked", async () => {
  const { sqlite, d1 } = createDatabase();
  sqlite.exec(`INSERT INTO tasks (id,name,jd,status,sources,tech_keywords,company_keywords,signal_keywords,exclude_keywords,schedule,time_range)
    VALUES ('task-a','验证任务','','active','["知乎"]','["UVM"]','[]','[]','[]','仅手动运行','近30天');
    INSERT INTO task_run_locks (task_id, run_id, acquired_at, expires_at)
    VALUES ('task-a','run-existing','2026-08-28T00:00:00.000Z','2099-08-28T00:00:00.000Z');`);

  const result = await runTask(d1, "task-a", "https://example.test");

  assert.equal(result.status, "already_running");
  assert.equal(result.runId, "run-existing");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM runs").get()?.count, 0);
});
