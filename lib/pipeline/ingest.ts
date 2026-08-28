import { calculateDeterministicScore } from "../ai/score";
import { clampConfidence, clampScore, validateEvidenceQuotes } from "../ai/validators";
import { normalizeCandidate } from "../connectors/normalize";
import { parseStringArray } from "../json";
import type { CandidateItem, IngestStats, TaskRecord } from "../types";
import { recordRunEvent } from "../runs/logger";
import { matchItemToTask } from "./match";
import { upsertRawItem, upsertTaskMatch } from "./persist";
import { prefilterItem } from "./prefilter";

export async function ingestCandidates(db: D1Database, task: TaskRecord, items: CandidateItem[], context?: { runId?: string; source?: string }): Promise<IngestStats> {
  const stats: IngestStats = { fetched: items.length, filtered: 0, deduped: 0, valid: 0, highValue: 0, timeFiltered: 0, blacklistFiltered: 0, advertisementFiltered: 0, matched: 0, analyzed: 0, failed: 0 };
  const tech = parseStringArray(task.tech_keywords);
  const companies = parseStringArray(task.company_keywords);
  const signals = parseStringArray(task.signal_keywords);
  const excludes = parseStringArray(task.exclude_keywords);
  const filterRow = await db.prepare("SELECT author_blacklist, company_blacklist FROM task_filters WHERE task_id = ?").bind(task.id).first<Record<string, string>>();
  const authorBlacklist = parseStringArray(filterRow?.author_blacklist);
  const companyBlacklist = parseStringArray(filterRow?.company_blacklist);
  const timeRangeDays = Number(task.time_range.match(/\d+/)?.[0] ?? 30);
  for (const item of items) {
    let normalized;
    try {
      normalized = normalizeCandidate(item);
    } catch {
      stats.filtered += 1;
      stats.failed = (stats.failed ?? 0) + 1;
      continue;
    }
    const persisted = await upsertRawItem(db, normalized);
    const prefilter = prefilterItem(normalized, { timeRangeDays, excludes, authorBlacklist, companyBlacklist });
    if (!prefilter.accepted) {
      stats.filtered += 1;
      if (prefilter.reasonCode === "outside_time_range") stats.timeFiltered = (stats.timeFiltered ?? 0) + 1;
      else if (prefilter.reasonCode === "advertisement") stats.advertisementFiltered = (stats.advertisementFiltered ?? 0) + 1;
      else if (["author_blacklist", "company_blacklist", "content_exclude"].includes(String(prefilter.reasonCode))) stats.blacklistFiltered = (stats.blacklistFiltered ?? 0) + 1;
      continue;
    }
    const match = matchItemToTask(normalized, { tech, companies, signals });
    if (!match.matched) { stats.filtered += 1; continue; }
    stats.matched = (stats.matched ?? 0) + 1;
    const taskMatch = await upsertTaskMatch(db, { taskId: task.id, rawItemId: persisted.rawItemId, ...match });
    if (persisted.unchanged && !taskMatch.created) { stats.deduped += 1; continue; }

    const existingLead = await db.prepare("SELECT id FROM leads WHERE task_id=? AND raw_item_id=? LIMIT 1")
      .bind(task.id, persisted.rawItemId).first();
    if (existingLead) { stats.deduped += 1; continue; }

    const raw = normalized.rawPayload ?? {};
    const ai = raw.aiAnalysis && typeof raw.aiAnalysis === "object" ? raw.aiAnalysis as Record<string, unknown> : null;
    const now = new Date().toISOString();
    const analysisId = `analysis-${crypto.randomUUID()}`;
    if (!ai) {
      await db.prepare(`INSERT INTO analyses (id, raw_item_id, model, prompt_version, taxonomy_version, intelligence_type,
        uncertainty, raw_output, status, error_code, created_at) VALUES (?, ?, 'unavailable', 'agent-v1', 'chip-v1',
        'uncertain', ?, '{}', 'analysis_failed', 'missing_ai_analysis', ?)`)
        .bind(analysisId, persisted.rawItemId, JSON.stringify(["没有收到经过结构化校验的 AI 分析"]), now).run();
      stats.failed = (stats.failed ?? 0) + 1;
      continue;
    }

    const intent = ["强", "中", "无"].includes(String(ai.intent)) ? String(ai.intent) : "无";
    const intelligenceType = ["人才线索", "企业情报"].includes(String(ai.intelligenceType)) ? String(ai.intelligenceType) : "待判断";
    const leadType = intelligenceType === "人才线索" ? "talent" : intelligenceType === "企业情报" ? "company_intelligence" : "uncertain";
    const evidenceInput = Array.isArray(ai.evidenceQuotes) ? ai.evidenceQuotes : String(ai.evidence ?? "").split(/[；\n]/).filter(Boolean);
    const evidence = validateEvidenceQuotes(normalized.fullText ?? normalized.snippet, evidenceInput);
    const requiresEvidence = intent === "强" || leadType === "company_intelligence";
    const aiConfidence = clampConfidence(ai.confidence);
    const identityConfidence = normalized.author?.nickname && normalized.author.nickname !== "未公开" ? Math.max(0.55, aiConfidence) : Math.min(0.3, aiConfidence);
    const evidenceConfidence = evidence.allValid ? Math.max(0.7, aiConfidence) : evidence.accepted.length ? Math.min(0.6, aiConfidence) : 0;
    const intentScore = intent === "强" ? 85 : intent === "中" ? 55 : 0;
    const intelScore = leadType === "company_intelligence" ? clampScore(ai.score) : 0;
    const score = calculateDeterministicScore({
      leadType, jobMatchScore: match.matchScore, intentScore, intelScore, identityConfidence, evidenceConfidence,
      publishedAt: normalized.publishedAt, timeRangeDays,
      targetCompanyMatched: companies.some((company) => match.matchedKeywords.includes(company)),
    });
    const analysisStatus = requiresEvidence && !evidence.allValid ? "invalid_evidence" : "success";
    const errorCode = analysisStatus === "success" ? "" : "evidence_not_found";
    const tags = Array.isArray(ai.tags) ? ai.tags.map(String).slice(0, 8) : match.matchedKeywords.slice(0, 8);
    const summary = String(ai.companyNote ?? ai.reasoningSummary ?? "").slice(0, 1_000);
    await db.prepare(`INSERT INTO analyses (id, raw_item_id, model, prompt_version, taxonomy_version, intelligence_type,
      job_match_score, job_intent_score, company_intel_score, identity_confidence, evidence_confidence, tags,
      evidence_quotes, summary, uncertainty, raw_output, status, error_code, created_at)
      VALUES (?, ?, ?, 'agent-v1', 'chip-v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(analysisId, persisted.rawItemId, String(ai.model ?? "configured-model"), leadType, match.matchScore, intentScore,
        intelScore, identityConfidence, evidenceConfidence, JSON.stringify(tags), JSON.stringify(evidence.accepted), summary,
        JSON.stringify(analysisStatus === "success" ? [] : ["AI 引用无法在标准化原文中核验"]), JSON.stringify(ai), analysisStatus, errorCode, now).run();
    stats.analyzed = (stats.analyzed ?? 0) + 1;
    if (analysisStatus !== "success") { stats.failed = (stats.failed ?? 0) + 1; continue; }

    const leadId = `lead-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO leads (
      id, task_id, raw_item_id, analysis_id, lead_type, source, author, author_id, published_at, snippet, tags,
      intent, intelligence_type, priority, score, job_match_score, intent_score, intel_score, identity_confidence,
      evidence_confidence, overall_score, company_note, evidence, url, review_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(leadId, task.id, persisted.rawItemId, analysisId, leadType, normalized.source, normalized.author?.nickname ?? "未公开",
        normalized.author?.publicId ?? "", normalized.publishedAt ?? "时间未知", normalized.snippet, JSON.stringify(tags), intent,
        intelligenceType, score.priority, score.overallScore, match.matchScore, intentScore, intelScore, identityConfidence,
        evidenceConfidence, score.overallScore, summary, evidence.accepted.join("；"), normalized.canonicalUrl, now).run();
    stats.valid += 1;
    if (score.priority === "A") stats.highValue += 1;
  }
  if (context?.runId) await recordRunEvent(db, { runId: context.runId, stage: "persist", source: context.source, message: "内容批次处理完成", metadata: stats });
  return stats;
}
