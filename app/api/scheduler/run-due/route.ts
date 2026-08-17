import { env } from "cloudflare:workers";
import { ensureDatabase, getD1 } from "../../../../db/bootstrap";
import { runTask } from "../../../../lib/pipeline";

export async function POST(request: Request) {
  await ensureDatabase();
  const config = env as unknown as Record<string, unknown>;
  const expected = typeof config.SCHEDULER_SECRET === "string" ? config.SCHEDULER_SECRET : "";
  if (!expected) return Response.json({ error: "尚未配置调度密钥" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${expected}`) return Response.json({ error: "调度鉴权失败" }, { status: 401 });
  const db = getD1();
  const due = await db.prepare(`SELECT t.id FROM tasks t LEFT JOIN task_filters f ON f.task_id=t.id
    WHERE t.status='active' AND COALESCE(f.schedule_enabled,1)=1 AND (f.next_run_at IS NULL OR f.next_run_at='' OR f.next_run_at<=?) LIMIT 10`)
    .bind(new Date().toISOString()).all<{ id: string }>();
  const origin = new URL(request.url).origin;
  const results = [];
  for (const row of due.results) results.push(await runTask(db, row.id, origin));
  return Response.json({ ok: true, processed: results.length, results });
}
