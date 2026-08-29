import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const migrations = [
  "0000_same_agent_zero.sql", "0001_seed-validation-data.sql", "0002_backend_pipeline.sql",
  "0003_connector_truth.sql", "0004_connector_settings.sql", "0005_remove_eetop.sql",
  "0006_analysis_audit.sql", "0007_source_deep_read_limits.sql", "0008_zhihu_only.sql",
  "0009_remove_legacy_seed_data.sql", "0010_global_content_and_analysis.sql", "0011_import_batches.sql", "0012_run_locks.sql",
  "0013_analysis_request_audit.sql",
];

test("applies every forward migration to a fresh SQLite database", () => {
  const directory = mkdtempSync(join(tmpdir(), "xintan-migrations-"));
  const database = join(directory, "test.sqlite");
  const project = resolve(import.meta.dirname, "../..");
  for (const migration of migrations) {
    execFileSync("sqlite3", [database], { input: readFileSync(join(project, "drizzle", migration), "utf8") });
  }
  const tables = execFileSync("sqlite3", [database, "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"], { encoding: "utf8" });
  for (const table of ["raw_items", "legacy_raw_items", "task_item_matches", "analyses", "run_source_stats", "run_events", "task_run_locks"]) {
    assert.match(tables, new RegExp(`^${table}$`, "m"));
  }
  assert.equal(execFileSync("sqlite3", [database, "SELECT COUNT(*) FROM tasks;"], { encoding: "utf8" }).trim(), "0");
  assert.equal(execFileSync("sqlite3", [database, "SELECT COUNT(*) FROM leads;"], { encoding: "utf8" }).trim(), "0");
  const rawColumns = execFileSync("sqlite3", [database, "SELECT name FROM pragma_table_info('raw_items');"], { encoding: "utf8" });
  assert.match(rawColumns, /^canonical_url$/m);
  assert.doesNotMatch(rawColumns, /^task_id$/m);
  const analysisColumns = execFileSync("sqlite3", [database, "SELECT name FROM pragma_table_info('analyses');"], { encoding: "utf8" });
  for (const column of ["response_id", "latency_ms", "retry_count", "recommended_action"]) assert.match(analysisColumns, new RegExp(`^${column}$`, "m"));
});

test("migrates task-scoped legacy rows into one global item without orphan matches", () => {
  const directory = mkdtempSync(join(tmpdir(), "xintan-legacy-migration-"));
  const database = join(directory, "test.sqlite");
  const project = resolve(import.meta.dirname, "../..");
  const globalContentMigration = migrations.indexOf("0010_global_content_and_analysis.sql");
  for (const migration of migrations.slice(0, globalContentMigration)) {
    execFileSync("sqlite3", [database], { input: readFileSync(join(project, "drizzle", migration), "utf8") });
  }
  const setup = `
    INSERT INTO tasks (id,name,jd,status,sources,tech_keywords,company_keywords,signal_keywords,exclude_keywords,schedule,time_range)
    VALUES ('a','A','','active','["知乎"]','[]','[]','[]','[]','仅手动运行','近30天'),
           ('b','B','','active','["知乎"]','[]','[]','[]','[]','仅手动运行','近30天');
    INSERT INTO raw_items (id,task_id,source,external_id,content_hash,author,author_id,published_at,source_url,snippet,raw_payload,fetched_at)
    VALUES ('old-a','a','知乎','','hash-a','作者','','2026-08-20','https://www.zhihu.com/question/9','同一内容','{}','2026-08-20'),
           ('old-b','b','知乎','','hash-b','作者','','2026-08-20','https://www.zhihu.com/question/9','同一内容','{}','2026-08-21');
  `;
  execFileSync("sqlite3", [database], { input: setup });
  execFileSync("sqlite3", [database], { input: readFileSync(join(project, "drizzle", "0010_global_content_and_analysis.sql"), "utf8") });

  assert.equal(execFileSync("sqlite3", [database, "SELECT COUNT(*) FROM raw_items;"], { encoding: "utf8" }).trim(), "1");
  assert.equal(execFileSync("sqlite3", [database, "SELECT COUNT(*) FROM task_item_matches;"], { encoding: "utf8" }).trim(), "2");
  assert.equal(execFileSync("sqlite3", [database, "SELECT COUNT(*) FROM task_item_matches m LEFT JOIN raw_items r ON r.id=m.raw_item_id WHERE r.id IS NULL;"], { encoding: "utf8" }).trim(), "0");
});
