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
        uncertainty, raw_output, status, error_code, response_id, latency_ms, retry_count, recommended_action, created_at)
        VALUES (?, ?, 'unavailable', 'agent-v2', 'chip-v1', 'uncertain', ?, '{}', 'analysis_failed',
        'missing_ai_analysis', '', 0, 0, 'human_review', ?)`)
        .bind(analysisId, persisted.rawItemId, JSON.stringify(["没有收到经过结构化校验的 AI 分析"]), now).run();
      stats.failed = (stats.failed ?? 0) + 1;
      continue;
    }

    const intent = ["强", "中", "无"].includes(String(ai.intent)) ? String(ai.intent) : "无";
    const contentType = String(ai.contentType ?? "");
    const leadType = contentType === "both" ? "both"
      : contentType === "talent" || (!contentType && ai.intelligenceType === "人才线索") ? "talent"
        : contentType === "company_intelligence" || (!contentType && ai.intelligenceType === "企业情报") ? "company_intelligence"
          : "uncertain";
    const intelligenceType = leadType === "talent" ? "人才线索" : leadType === "company_intelligence" ? "企业情报" : leadType === "both" ? "人才与企业情报" : "待判断";
    const evidenceInput = Array.isArray(ai.evidenceQuotes) ? ai.evidenceQuotes : String(ai.evidence ?? "").split(/[；\n]/).filter(Boolean);
    const evidence = validateEvidenceQuotes(normalized.fullText ?? normalized.snippet, evidenceInput);
    const requiresEvidence = intent === "强" || ["company_intelligence", "both"].includes(leadType);
    const aiConfidence = clampConfidence(ai.confidence);
    const statedIdentityConfidence = ai.identityConfidence === undefined ? aiConfidence : clampConfidence(ai.identityConfidence);
    const identityConfidence = normalized.author?.nickname && normalized.author.nickname !== "未公开" ? statedIdentityConfidence : Math.min(0.3, statedIdentityConfidence);
    const statedEvidenceConfidence = ai.evidenceConfidence === undefined ? aiConfidence : clampConfidence(ai.evidenceConfidence);
    const evidenceConfidence = evidence.allValid ? statedEvidenceConfidence : evidence.accepted.length ? Math.min(0.6, statedEvidenceConfidence) : 0;
    const jobMatchScore = ai.jobMatchScore === undefined ? match.matchScore : clampScore(ai.jobMatchScore);
    const intentScore = ai.intentScore === undefined ? intent === "强" ? 85 : intent === "中" ? 55 : 0 : clampScore(ai.intentScore);
    const intelScore = ["company_intelligence", "both"].includes(leadType)
      ? clampScore(ai.companyIntelScore ?? ai.score) : 0;
    const score = calculateDeterministicScore({
      leadType, jobMatchScore, intentScore, intelScore, identityConfidence, evidenceConfidence,
      publishedAt: normalized.publishedAt, timeRangeDays,
      targetCompanyMatched: companies.some((company) => match.matchedKeywords.includes(company)),
    });
    const filteredContent = ["industry_discussion", "recruitment_ad", "marketing", "irrelevant"].includes(contentType);
    const analysisStatus = filteredContent ? "filtered_content" : requiresEvidence && !evidence.allValid ? "invalid_evidence" : "success";
    const errorCode = filteredContent ? `content_type_${contentType}` : analysisStatus === "success" ? "" : "evidence_not_found";
    const tags = Array.isArray(ai.tags) ? ai.tags.map(String).slice(0, 8) : match.matchedKeywords.slice(0, 8);
    const summary = String(ai.companyNote ?? ai.reasoningSummary ?? "").slice(0, 1_000);
    const uncertainty = Array.isArray(ai.uncertainty) ? ai.uncertainty.map(String).slice(0, 8) : [];
    const recommendedAction = ["human_review", "follow_up", "monitor", "ignore"].includes(String(ai.recommendedAction))
      ? String(ai.recommendedAction) : "human_review";
    await db.prepare(`INSERT INTO analyses (id, raw_item_id, model, prompt_version, taxonomy_version, intelligence_type,
      job_match_score, job_intent_score, company_intel_score, identity_confidence, evidence_confidence, tags,
      evidence_quotes, summary, uncertainty, raw_output, status, error_code, response_id, latency_ms, retry_count,
      recommended_action, created_at)
      VALUES (?, ?, ?, 'agent-v2', 'chip-v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(analysisId, persisted.rawItemId, String(ai.model ?? "configured-model"), leadType, jobMatchScore, intentScore,
        intelScore, identityConfidence, evidenceConfidence, JSON.stringify(tags), JSON.stringify(evidence.accepted), summary,
        JSON.stringify(analysisStatus === "success" ? uncertainty : [...uncertainty, "AI 引用无法在标准化原文中核验"]),
        JSON.stringify(ai), analysisStatus, errorCode, String(ai.responseId ?? "").slice(0, 200),
        Math.max(0, Math.round(Number(ai.latencyMs ?? 0))), Math.max(0, Math.round(Number(ai.retryCount ?? 0))),
        recommendedAction, now).run();
    stats.analyzed = (stats.analyzed ?? 0) + 1;
    if (analysisStatus === "filtered_content") { stats.filtered += 1; continue; }
    if (analysisStatus !== "success") { stats.failed = (stats.failed ?? 0) + 1; continue; }

    const leadId = `lead-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO leads (
      id, task_id, raw_item_id, analysis_id, lead_type, source, author, author_id, published_at, snippet, tags,
      intent, intelligence_type, priority, score, job_match_score, intent_score, intel_score, identity_confidence,
      evidence_confidence, overall_score, company_note, evidence, url, review_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(leadId, task.id, persisted.rawItemId, analysisId, leadType, normalized.source, normalized.author?.nickname ?? "未公开",
        normalized.author?.publicId ?? "", normalized.publishedAt ?? "时间未知", normalized.snippet, JSON.stringify(tags), intent,
        intelligenceType, score.priority, score.overallScore, jobMatchScore, intentScore, intelScore, identityConfidence,
        evidenceConfidence, score.overallScore, summary, evidence.accepted.join("；"), normalized.canonicalUrl, now).run();
    stats.valid += 1;
    if (score.priority === "A") stats.highValue += 1;
  }
  if (context?.runId) await recordRunEvent(db, { runId: context.runId, stage: "persist", source: context.source, message: "内容批次处理完成", metadata: stats });
  return stats;
}
