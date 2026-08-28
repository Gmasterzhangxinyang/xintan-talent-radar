import assert from "node:assert/strict";
import test from "node:test";
import { matchItemToTask } from "../../lib/pipeline/match";
import { prefilterItem } from "../../lib/pipeline/prefilter";
import type { CollectedItem } from "../../lib/connectors/types";

const base: CollectedItem = {
  source: "知乎", canonicalUrl: "https://www.zhihu.com/question/1", author: { nickname: "公开作者" },
  publishedAt: new Date().toISOString(), snippet: "做过 UVM 和 VCS 验证，项目收尾后考虑机会。", contentType: "answer",
};

test("returns a unique hard-filter reason code", () => {
  assert.deepEqual(prefilterItem(base, { timeRangeDays: 30, excludes: [], authorBlacklist: ["公开作者"], companyBlacklist: [] }), {
    accepted: false, reasonCode: "author_blacklist",
  });
  assert.deepEqual(prefilterItem({ ...base, snippet: "芯片培训班课程报名" }, { timeRangeDays: 30, excludes: [], authorBlacklist: [], companyBlacklist: [] }), {
    accepted: false, reasonCode: "advertisement",
  });
});

test("matches a task without assigning final business priority", () => {
  const match = matchItemToTask(base, { tech: ["UVM", "VCS"], companies: [], signals: ["考虑机会"] });
  assert.equal(match.matched, true);
  assert.deepEqual(match.matchedKeywords, ["UVM", "VCS", "考虑机会"]);
  assert.ok(match.matchScore > 0 && match.matchScore <= 100);
  assert.equal("priority" in match, false);
});
