import assert from "node:assert/strict";
import test from "node:test";
import { safeSpreadsheetText, spreadsheetCell } from "../../lib/export";

test("neutralizes spreadsheet formula injection", () => {
  for (const value of ["=HYPERLINK(\"https://evil.invalid\")", "+1+1", "-2+3", "@SUM(A1:A2)"]) {
    assert.equal(safeSpreadsheetText(value).startsWith("'"), true);
  }
  assert.equal(safeSpreadsheetText("正常公开内容"), "正常公开内容");
});

test("creates a clickable link only for HTTP(S) URLs", () => {
  assert.match(spreadsheetCell("来源", { href: "https://www.zhihu.com/question/1" }), /ss:HRef="https:\/\/www\.zhihu\.com\/question\/1"/);
  assert.doesNotMatch(spreadsheetCell("本地", { href: "file:///tmp/private" }), /ss:HRef/);
});
