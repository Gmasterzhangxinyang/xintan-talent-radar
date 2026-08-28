import type { CollectedItem } from "../connectors/types";

export function matchItemToTask(item: CollectedItem, keywords: { tech: string[]; companies: string[]; signals: string[] }) {
  const content = `${item.title ?? ""} ${item.fullText ?? item.snippet}`.toLowerCase();
  const matchedKeywords = [...new Set([...keywords.tech, ...keywords.companies, ...keywords.signals]
    .filter((term) => term && content.includes(term.toLowerCase())))];
  const techCount = keywords.tech.filter((term) => matchedKeywords.includes(term)).length;
  const companyCount = keywords.companies.filter((term) => matchedKeywords.includes(term)).length;
  const signalCount = keywords.signals.filter((term) => matchedKeywords.includes(term)).length;
  const matchScore = Math.min(100, techCount * 18 + companyCount * 20 + signalCount * 24);
  return {
    matched: matchedKeywords.length > 0,
    matchedKeywords,
    matchScore,
    matchReason: matchedKeywords.length ? `命中：${matchedKeywords.join("、")}` : "未命中任务关键词",
  };
}
