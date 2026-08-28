import { contentHash } from "../dedupe";
import type { CollectedItem } from "../connectors/types";

export async function upsertRawItem(db: D1Database, item: CollectedItem) {
  const hash = await contentHash(item.source, item.fullText || item.snippet, item.canonicalUrl);
  const existing = await db.prepare(`SELECT id, content_hash FROM raw_items
    WHERE source = ? AND (canonical_url = ? OR (? <> '' AND external_id = ?)) LIMIT 1`)
    .bind(item.source, item.canonicalUrl, item.externalId ?? "", item.externalId ?? "").first<{ id: string; content_hash: string }>();
  const now = new Date().toISOString();
  if (existing) {
    const unchanged = existing.content_hash === hash;
    if (!unchanged) {
      await db.prepare(`UPDATE raw_items SET canonical_url=?, content_hash=?, author=?, author_id=?, author_profile_url=?,
        published_at=?, published_at_raw=?, time_confidence=?, title=?, snippet=?, full_text=?, content_type=?, raw_payload=?, updated_at=? WHERE id=?`)
        .bind(item.canonicalUrl, hash, item.author?.nickname ?? "未公开", item.author?.publicId ?? "", item.author?.profileUrl ?? "",
          item.publishedAt ?? null, item.publishedAtRaw ?? "", item.timeConfidence ?? "unknown", item.title ?? "", item.snippet,
          item.fullText ?? item.snippet, item.contentType, JSON.stringify(item.rawPayload ?? {}), now, existing.id).run();
    }
    return { rawItemId: existing.id, unchanged, created: false, contentHash: hash };
  }

  const rawItemId = `raw-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO raw_items (
    id, source, external_id, canonical_url, content_hash, author, author_id, author_profile_url,
    published_at, published_at_raw, time_confidence, title, snippet, full_text, content_type,
    raw_payload, fetched_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(rawItemId, item.source, item.externalId ?? "", item.canonicalUrl, hash, item.author?.nickname ?? "未公开",
      item.author?.publicId ?? "", item.author?.profileUrl ?? "", item.publishedAt ?? null, item.publishedAtRaw ?? "",
      item.timeConfidence ?? "unknown", item.title ?? "", item.snippet, item.fullText ?? item.snippet, item.contentType,
      JSON.stringify(item.rawPayload ?? {}), now, now).run();
  return { rawItemId, unchanged: false, created: true, contentHash: hash };
}

export async function upsertTaskMatch(db: D1Database, input: {
  taskId: string;
  rawItemId: string;
  matchedKeywords: string[];
  matchScore: number;
  matchReason: string;
}) {
  const existing = await db.prepare("SELECT id FROM task_item_matches WHERE task_id=? AND raw_item_id=?")
    .bind(input.taskId, input.rawItemId).first<{ id: string }>();
  const now = new Date().toISOString();
  if (existing) {
    await db.prepare(`UPDATE task_item_matches SET matched_keywords=?, match_score=?, match_reason=?, last_matched_at=? WHERE id=?`)
      .bind(JSON.stringify(input.matchedKeywords), input.matchScore, input.matchReason, now, existing.id).run();
    return { id: existing.id, created: false };
  }
  const id = `match-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO task_item_matches
    (id, task_id, raw_item_id, matched_keywords, match_score, match_reason, first_matched_at, last_matched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.taskId, input.rawItemId, JSON.stringify(input.matchedKeywords), input.matchScore, input.matchReason, now, now).run();
  return { id, created: true };
}
