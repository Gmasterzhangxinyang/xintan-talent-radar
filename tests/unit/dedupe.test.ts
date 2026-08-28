import assert from "node:assert/strict";
import test from "node:test";
import { contentHash, normalizeContent } from "../../lib/dedupe";

test("normalizes harmless punctuation, whitespace and embedded URLs", () => {
  assert.equal(
    normalizeContent("  UVM，验证项目！ https://example.com/a  "),
    normalizeContent("uvm 验证项目"),
  );
});

test("produces deterministic SHA-256 fingerprints", async () => {
  const first = await contentHash("知乎", "准备看看新的机会。", "https://www.zhihu.com/question/1/");
  const second = await contentHash("知乎", "准备看看新的机会", "https://www.zhihu.com/question/1");
  const different = await contentHash("知乎", "没有求职计划", "https://www.zhihu.com/question/1");

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, different);
});

test("uses a global content identity independent of a task", async () => {
  const hash = await contentHash("知乎", "同一条公开内容", "https://www.zhihu.com/question/2");
  assert.equal(hash, await contentHash("知乎", "同一条公开内容", "https://www.zhihu.com/question/2"));
});
