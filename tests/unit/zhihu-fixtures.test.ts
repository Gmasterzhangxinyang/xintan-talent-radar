import assert from "node:assert/strict";
import test from "node:test";
import { isZhihuContentUrl, parseVisibleDate } from "../../local-assistant/zhihu-utils.mjs";

const NOW = new Date("2026-08-28T12:00:00.000Z");

test("parses Zhihu relative and localized timestamps deterministically", () => {
  assert.equal(parseVisibleDate("2小时前", NOW)?.toISOString(), "2026-08-28T10:00:00.000Z");
  assert.equal(parseVisibleDate("3天前", NOW)?.toISOString(), "2026-08-25T12:00:00.000Z");
  assert.equal(parseVisibleDate("发布于 2026-08-27", NOW)?.getUTCFullYear(), 2026);
  assert.equal(parseVisibleDate("未公开", NOW), null);
});

test("assigns a missing year without moving a future date forward", () => {
  assert.equal(parseVisibleDate("8月20日", NOW)?.getFullYear(), 2026);
  assert.equal(parseVisibleDate("12月20日", NOW)?.getFullYear(), 2025);
});

test("accepts only canonical Zhihu content routes", () => {
  assert.equal(isZhihuContentUrl("https://www.zhihu.com/question/123/answer/456"), true);
  assert.equal(isZhihuContentUrl("https://zhuanlan.zhihu.com/p/123"), true);
  assert.equal(isZhihuContentUrl("https://www.zhihu.com/search?q=chip"), false);
  assert.equal(isZhihuContentUrl("https://evil.example/question/123"), false);
});
