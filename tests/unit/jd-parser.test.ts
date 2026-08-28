import assert from "node:assert/strict";
import test from "node:test";
import { parseJd } from "../../lib/jd-parser";

test("extracts stable chip-role fields and creates separate query groups", () => {
  const parsed = parseJd("上海数字验证工程师，5年以上经验，熟悉 UVM、SystemVerilog、VCS 和 Verdi，有 SoC 流片经验。");

  assert.match(parsed.role, /数字验证/);
  assert.equal(parsed.years, "5年以上");
  assert.deepEqual(parsed.locations, ["上海"]);
  assert.deepEqual(new Set(parsed.techKeywords), new Set(["UVM", "SystemVerilog", "VCS", "Verdi", "SoC", "数字验证", "流片", "验证工程师", "功能验证", "RTL验证"]));
  assert.ok(parsed.queryGroups.length >= 2);
  assert.ok(parsed.queryGroups.every((query) => query.length < 160));
});

test("does not invent a target company that is absent from the JD", () => {
  const parsed = parseJd("深圳 FPGA 工程师，熟悉 Verilog，三年以上经验。");
  assert.deepEqual(parsed.companyKeywords, []);
  assert.deepEqual(parsed.locations, ["深圳"]);
});
