import assert from "node:assert/strict";
import test from "node:test";
import { calculateDeterministicScore, recencyScore } from "../../lib/ai/score";
import { validateEvidenceQuotes } from "../../lib/ai/validators";

test("accepts only evidence that exists in the normalized source content", () => {
  const validation = validateEvidenceQuotes("最近项目收尾，我也在考虑下一步机会。", ["项目收尾", "准备立刻离职"]);
  assert.deepEqual(validation.accepted, ["项目收尾"]);
  assert.equal(validation.allValid, false);
});

test("uses deterministic scoring and blocks A priority with weak evidence", () => {
  const strong = calculateDeterministicScore({
    leadType: "talent", jobMatchScore: 100, intentScore: 100, intelScore: 0,
    identityConfidence: 1, evidenceConfidence: 0.9, publishedAt: new Date().toISOString(), timeRangeDays: 30,
  });
  const weakEvidence = calculateDeterministicScore({
    leadType: "talent", jobMatchScore: 100, intentScore: 100, intelScore: 0,
    identityConfidence: 1, evidenceConfidence: 0.2, publishedAt: new Date().toISOString(), timeRangeDays: 30,
  });
  assert.equal(strong.priority, "A");
  assert.equal(weakEvidence.priority, "待判断");
});

test("recency decays instead of using a fixed constant", () => {
  const current = recencyScore(new Date().toISOString(), 30);
  const old = recencyScore(new Date(Date.now() - 29 * 86_400_000).toISOString(), 30);
  assert.ok(current > old);
  assert.equal(recencyScore("无法识别", 30), 0);
});
