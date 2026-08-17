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
  assert.match(page, /simulateRun/);
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
  assert.equal(JSON.parse(hosting).d1, "DB");
});
