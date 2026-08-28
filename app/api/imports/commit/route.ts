import { ensureDatabase, getD1 } from "../../../../db/bootstrap";
import { normalizeCandidate } from "../../../../lib/connectors/normalize";
import { ingestCandidates } from "../../../../lib/pipeline/ingest";
import type { CandidateItem, TaskRecord } from "../../../../lib/types";

export async function POST(request: Request) {
  await ensureDatabase();
  const db = getD1();
  try {
    const payload = await request.json() as {
      taskId?: string; fileName?: string; format?: string; items?: CandidateItem[];
      previewTotal?: number; previewFailed?: number; analysisFiltered?: number; analysisFailed?: number;
      rowReports?: Array<{ rowNumber?: number; status?: string; errorCode?: string; errorMessage?: string }>;
    };
    const taskId = String(payload.taskId ?? "");
    const task = await db.prepare("SELECT * FROM tasks WHERE id=?").bind(taskId).first<TaskRecord>();
    if (!task) return Response.json({ error: "请选择有效检索任务" }, { status: 404 });
    const incoming = Array.isArray(payload.items) ? payload.items.slice(0, 2_000) : [];
    const previewTotal = Math.max(incoming.length, Math.min(2_000, Number(payload.previewTotal ?? incoming.length) || 0));
    if (!previewTotal) return Response.json({ error: "没有可导入的数据" }, { status: 400 });
    const valid: CandidateItem[] = [];
    const errors: Array<{ rowNumber: number; code: string; message: string }> = [];
    incoming.forEach((item, index) => {
      try { normalizeCandidate(item); valid.push(item); }
      catch (error) { errors.push({ rowNumber: index + 2, code: "invalid_row", message: error instanceof Error ? error.message : "字段无效" }); }
    });
    const batchId = `import-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO import_batches (id, task_id, file_name, format, status, total, failed, created_at)
      VALUES (?, ?, ?, ?, 'processing', ?, ?, ?)`)
      .bind(batchId, taskId, String(payload.fileName ?? "manual-import").slice(0, 240), String(payload.format ?? "unknown").slice(0, 20), previewTotal, 0, now).run();
    const submittedReports = Array.isArray(payload.rowReports) ? payload.rowReports.slice(0, 2_000) : [];
    const rowReports = [...submittedReports, ...errors.map((item) => ({ rowNumber: item.rowNumber, status: "failed", errorCode: item.code, errorMessage: item.message }))];
    for (const report of rowReports) {
      const status = ["processed", "filtered", "failed"].includes(String(report.status)) ? String(report.status) : "failed";
      await db.prepare(`INSERT INTO import_rows (id, batch_id, row_number, status, error_code, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(`import-row-${crypto.randomUUID()}`, batchId, Math.max(1, Number(report.rowNumber) || 1),
          status, String(report.errorCode ?? "").slice(0, 80), String(report.errorMessage ?? "").slice(0, 1_000), now).run();
    }
    const stats = valid.length ? await ingestCandidates(db, task, valid) : { fetched: 0, filtered: 0, deduped: 0, valid: 0, highValue: 0, failed: 0 };
    const filtered = stats.filtered + Math.max(0, Number(payload.analysisFiltered ?? 0) || 0);
    const failed = (stats.failed ?? 0) + errors.length + Math.max(0, Number(payload.previewFailed ?? 0) || 0) + Math.max(0, Number(payload.analysisFailed ?? 0) || 0);
    const finishedAt = new Date().toISOString();
    await db.prepare(`UPDATE import_batches SET status=?, accepted=?, duplicated=?, filtered=?, failed=?, finished_at=? WHERE id=?`)
      .bind(failed ? (stats.valid ? "partial" : "failed") : "completed", stats.valid,
        stats.deduped, filtered, failed, finishedAt, batchId).run();
    return Response.json({ ok: true, batchId, total: previewTotal, imported: stats.valid, duplicated: stats.deduped, filtered, failed, errors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400 });
  }
}
