import { clampConfidence, clampScore } from "./validators";

export type ScoreInput = {
  leadType: "talent" | "company_intelligence" | "both" | "uncertain";
  jobMatchScore: number;
  intentScore: number;
  intelScore: number;
  identityConfidence: number;
  evidenceConfidence: number;
  publishedAt?: string | null;
  timeRangeDays?: number;
  targetCompanyMatched?: boolean;
};

export function recencyScore(publishedAt?: string | null, timeRangeDays = 30) {
  if (!publishedAt) return 0;
  const time = Date.parse(publishedAt);
  if (Number.isNaN(time)) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / 86_400_000);
  return clampScore(100 * Math.max(0, 1 - ageDays / Math.max(1, timeRangeDays)));
}

export function calculateDeterministicScore(input: ScoreInput) {
  const evidence = clampConfidence(input.evidenceConfidence);
  const identity = clampConfidence(input.identityConfidence);
  const recency = recencyScore(input.publishedAt, input.timeRangeDays);
  const talent = clampScore(
    clampScore(input.jobMatchScore) * 0.35 + clampScore(input.intentScore) * 0.30 + identity * 100 * 0.15 + recency * 0.10 + evidence * 100 * 0.10,
  );
  const company = clampScore(
    clampScore(input.intelScore) * 0.35 + (input.targetCompanyMatched ? 100 : 0) * 0.25 + recency * 0.20 + evidence * 100 * 0.20,
  );
  const overallScore = input.leadType === "talent" ? talent : input.leadType === "company_intelligence" ? company : input.leadType === "both" ? Math.max(talent, company) : 0;
  const priority = evidence < 0.4 || overallScore < 40 ? "待判断" : overallScore >= 80 && evidence >= 0.7 ? "A" : overallScore >= 60 ? "B" : "C";
  return { talentScore: talent, companyScore: company, overallScore, priority };
}
