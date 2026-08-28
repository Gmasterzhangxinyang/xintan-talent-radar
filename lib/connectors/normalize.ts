import type { CandidateItem } from "../types";
import type { CollectedItem } from "./types";

const TRACKING_PARAMETERS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "spm", "from", "source", "share_code", "share_token",
]);

export function canonicalizeUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported_url_protocol");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
  url.searchParams.sort();
  return url.toString();
}

export function normalizeCandidate(item: CandidateItem): CollectedItem {
  const canonicalUrl = canonicalizeUrl(item.url);
  const snippet = item.snippet.replace(/\s+/g, " ").trim();
  if (!snippet) throw new Error("empty_content");
  return {
    source: item.source.trim(),
    externalId: item.externalId?.trim(),
    canonicalUrl,
    author: item.author ? {
      nickname: item.author.trim(),
      publicId: item.authorId?.trim(),
      profileUrl: item.authorProfileUrl ? canonicalizeUrl(item.authorProfileUrl) : undefined,
    } : undefined,
    publishedAt: item.publishedAt,
    publishedAtRaw: item.publishedAtRaw ?? item.publishedAt,
    timeConfidence: item.timeConfidence ?? (item.publishedAt && !Number.isNaN(Date.parse(item.publishedAt)) ? "high" : "unknown"),
    title: item.title?.trim(),
    snippet,
    fullText: item.fullText?.replace(/\s+/g, " ").trim() || snippet,
    contentType: item.contentType ?? "post",
    rawPayload: item.raw && typeof item.raw === "object" ? item.raw as Record<string, unknown> : {},
  };
}
