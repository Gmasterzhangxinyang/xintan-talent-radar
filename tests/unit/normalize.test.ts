import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeUrl, normalizeCandidate } from "../../lib/connectors/normalize";

test("canonicalizes harmless tracking parameters but preserves identity parameters", () => {
  assert.equal(
    canonicalizeUrl("https://WWW.ZHIHU.com/question/1/?utm_source=test&answer_id=8#section"),
    "https://www.zhihu.com/question/1?answer_id=8",
  );
});

test("normalizes a connector candidate into the shared contract", () => {
  const item = normalizeCandidate({
    source: "知乎", author: " 公开作者 ", authorId: "id-1", publishedAt: "2026-08-20T00:00:00.000Z",
    snippet: "  一段   公开内容  ", url: "https://www.zhihu.com/question/1?utm_campaign=x",
  });
  assert.equal(item.canonicalUrl, "https://www.zhihu.com/question/1");
  assert.equal(item.author?.nickname, "公开作者");
  assert.equal(item.snippet, "一段 公开内容");
  assert.equal(item.timeConfidence, "high");
});

test("rejects non-HTTP URLs and empty content", () => {
  assert.throws(() => canonicalizeUrl("file:///tmp/private"), /unsupported_url_protocol/);
  assert.throws(() => normalizeCandidate({ source: "知乎", snippet: " ", url: "https://www.zhihu.com/question/1" }), /empty_content/);
});
