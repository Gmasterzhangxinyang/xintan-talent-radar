import { env } from "cloudflare:workers";
import { ensureDatabase, getD1 } from "../../../../../db/bootstrap";
import { ingestCandidates } from "../../../../../lib/pipeline";
import type { CandidateItem, TaskRecord } from "../../../../../lib/types";

export async function POST(request: Request) {
  await ensureDatabase();
  const config = env as unknown as Record<string, unknown>;
  const expected = typeof config.COMPUTER_AGENT_CALLBACK_SECRET === "string" ? config.COMPUTER_AGENT_CALLBACK_SECRET : "";
  if (!expected) return Response.json({ error: "尚未配置回调密钥" }, { status: 503 });
  if (request.headers.get("x-xintan-callback-secret") !== expected) return Response.json({ error: "回调鉴权失败" }, { status: 401 });
  const payload = await request.json() as { jobId?: string; taskId?: string; source?: string; items?: CandidateItem[]; error?: string };
  if (!payload.jobId || !payload.taskId || !payload.source || !Array.isArray(payload.items)) {
    return Response.json({ error: "jobId、taskId、source、items 为必填字段" }, { status: 400 });
  }
  const db = getD1();
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(payload.taskId).first<TaskRecord>();
  if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
  const items = payload.items.map((item) => ({ ...item, source: payload.source! }));
  const stats = await ingestCandidates(db, task, items);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE connector_jobs SET status = ?, completed_at = ?, fetched = ?, error = ? WHERE id = ? AND task_id = ?")
      .bind(payload.error ? "failed" : "completed", now, stats.fetched, payload.error ?? "", payload.jobId, payload.taskId),
    db.prepare("UPDATE tasks SET discovered = discovered + ?, high_value = high_value + ?, last_run_at = ? WHERE id = ?")
      .bind(stats.valid, stats.highValue, now, payload.taskId),
  ]);
  return Response.json({ ok: true, ...stats });
}
