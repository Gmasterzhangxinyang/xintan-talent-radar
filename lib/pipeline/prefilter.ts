import type { CollectedItem } from "../connectors/types";

export type PrefilterConfig = {
  timeRangeDays: number;
  excludes: string[];
  authorBlacklist: string[];
  companyBlacklist: string[];
};

const ADVERTISEMENT_TERMS = ["培训班", "课程报名", "招生", "加微信", "扫码咨询", "内推服务收费"];

export function prefilterItem(item: CollectedItem, config: PrefilterConfig) {
  const searchable = `${item.author?.nickname ?? ""} ${item.title ?? ""} ${item.fullText ?? item.snippet}`.toLowerCase();
  if (!item.canonicalUrl) return { accepted: false, reasonCode: "invalid_url" as const };
  if (!item.snippet.trim()) return { accepted: false, reasonCode: "empty_content" as const };
  if (item.publishedAt) {
    const published = Date.parse(item.publishedAt);
    if (!Number.isNaN(published) && published < Date.now() - config.timeRangeDays * 86_400_000) {
      return { accepted: false, reasonCode: "outside_time_range" as const };
    }
  }
  if (config.authorBlacklist.some((term) => (item.author?.nickname ?? "").toLowerCase().includes(term.toLowerCase()))) {
    return { accepted: false, reasonCode: "author_blacklist" as const };
  }
  if (config.companyBlacklist.some((term) => searchable.includes(term.toLowerCase()))) {
    return { accepted: false, reasonCode: "company_blacklist" as const };
  }
  if (config.excludes.some((term) => searchable.includes(term.toLowerCase()))) {
    return { accepted: false, reasonCode: "content_exclude" as const };
  }
  if (ADVERTISEMENT_TERMS.some((term) => searchable.includes(term))) {
    return { accepted: false, reasonCode: "advertisement" as const };
  }
  return { accepted: true, reasonCode: null };
}
