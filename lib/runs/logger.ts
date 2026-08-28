const RUN_STAGES = new Set(["dispatch", "login", "search", "collect", "normalize", "dedupe", "prefilter", "match", "analyze", "persist", "complete"]);

export async function recordRunEvent(db: D1Database, input: {
  runId: string;
  level?: "info" | "warning" | "error";
  stage: string;
  source?: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  if (!RUN_STAGES.has(input.stage)) throw new Error(`invalid_run_stage:${input.stage}`);
  await db.prepare(`INSERT INTO run_events (id, run_id, level, stage, source, message, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`event-${crypto.randomUUID()}`, input.runId, input.level ?? "info", input.stage, input.source ?? "", input.message.slice(0, 500), JSON.stringify(input.metadata ?? {}), new Date().toISOString()).run();
}
