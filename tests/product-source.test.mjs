import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../app/page.tsx", import.meta.url);
const schemaPath = new URL("../db/schema.ts", import.meta.url);
const hostingPath = new URL("../.openai/hosting.json", import.meta.url);

test("covers the complete MVP workflow", async () => {
  const page = await readFile(pagePath, "utf8");
  for (const capability of [
    "创建检索任务", "AI拆解技术栈和检索词", "增量扫描", "线索工作台",
    "导出Excel", "运行日志", "数据源", "求职信号", "企业情报",
  ]) {
    assert.match(page, new RegExp(capability));
  }
  assert.match(page, /reviewLead/);
  assert.match(page, /runSearchTask/);
});

test("uses D1-backed product records", async () => {
  const [schema, hosting] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(hostingPath, "utf8"),
  ]);
  assert.match(schema, /export const tasks/);
  assert.match(schema, /export const leads/);
  assert.match(schema, /export const runs/);
  assert.match(schema, /export const sources/);
  assert.match(schema, /export const rawItems/);
  assert.match(schema, /export const connectorJobs/);
  assert.match(schema, /export const connectorSettings/);
  assert.equal(JSON.parse(hosting).d1, "DB");
});

test("implements the server-side collection pipeline", async () => {
  const files = await Promise.all([
    "../lib/pipeline.ts", "../lib/connectors.ts", "../lib/analyzer.ts", "../lib/dedupe.ts",
    "../lib/connector-settings.ts", "../app/api/connectors/settings/route.ts", "../app/api/connectors/browser-sessions/route.ts",
    "../app/api/connectors/computer-agent/callback/route.ts", "../app/api/scheduler/run-due/route.ts", "../app/api/export/route.ts", "../app/api/health/route.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const source = files.join("\n");
  for (const capability of ["contentHash", "raw_items", "connector_jobs", "connector_settings", "browser-sessions", "reuseExistingProfile", "requireLiveView", "pauseOnViewerDisconnect", "liveViewUrl", "COMPUTER_AGENT_URL", "SCHEDULER_SECRET", "application/vnd.ms-excel", "AbortSignal.timeout", "core_operational_connectors_pending"]) {
    assert.match(source, new RegExp(capability));
  }
});

test("exposes a per-item analysis audit instead of blind scrolling", async () => {
  const [page, assistant, schema, migration] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(new URL("../local-assistant/server.mjs", import.meta.url), "utf8"),
    readFile(schemaPath, "utf8"),
    readFile(new URL("../drizzle/0006_analysis_audit.sql", import.meta.url), "utf8"),
  ]);
  for (const capability of ["AnalysisWorkspace", "analysisTrace", "AI中枢", "每一条都打开详情深读", "详情页可见内容", "AI引用的原文证据", "AI决策摘要", "下一步动作", "安全策略", "命中依据", "保留", "过滤"]) {
    assert.match(page, new RegExp(capability));
  }
  for (const capability of ["askAiBrain", "enforceAgentPolicy", "showItemAnalysis", "mandatoryDeepRead", "evidenceQuotes", "reading_detail", "data-xintan-candidate", "currentItem", "analysisTrace", "matchedKeywords", "central_ai_brain", "agent_loop"]) {
    assert.match(assistant, new RegExp(capability));
  }
  assert.match(schema, /analysisTrace/);
  assert.match(migration, /analysis_trace/);
});
