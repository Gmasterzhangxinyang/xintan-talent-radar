import { env } from "cloudflare:workers";
import { ensureDatabase, getD1 } from "../../../../../db/bootstrap";
import { ingestCandidates } from "../../../../../lib/pipeline";
import type { CandidateItem, TaskRecord } from "../../../../../lib/types";
import { hashSecret, loadConnectorSettings, validateAgentEndpoint } from "../../../../../lib/connector-settings";

export async function POST(request: Request) {
  await ensureDatabase();
  const db = getD1();
  const config = env as unknown as Record<string, unknown>;
  const settings = await loadConnectorSettings(db);
  const provided = request.headers.get("x-xintan-callback-secret") ?? "";
  const fallbackSecret = typeof config.COMPUTER_AGENT_CALLBACK_SECRET === "string" ? config.COMPUTER_AGENT_CALLBACK_SECRET : "";
  if (!settings?.callback_secret_hash && !fallbackSecret) return Response.json({ error: "尚未配置回调密钥" }, { status: 503 });
  const accepted = settings?.callback_secret_hash ? await hashSecret(provided) === settings.callback_secret_hash : provided === fallbackSecret;
  if (!accepted) return Response.json({ error: "回调鉴权失败" }, { status: 401 });
  const payload = await request.json() as {
    jobId?: string; taskId?: string; source?: string; event?: string; status?: string;
    progress?: number; action?: string; liveViewUrl?: string; screenshotUrl?: string;
    items?: CandidateItem[]; error?: string;
  };
  if (!payload.jobId || !payload.taskId || !payload.source) {
    return Response.json({ error: "jobId、taskId、source 为必填字段" }, { status: 400 });
  }
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(payload.taskId).first<TaskRecord>();
  if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
  const job = await db.prepare("SELECT id, live_view_url FROM connector_jobs WHERE id = ? AND task_id = ? AND source = ?")
    .bind(payload.jobId, payload.taskId, payload.source).first<{ id: string; live_view_url: string }>();
  if (!job) return Response.json({ error: "连接器任务不存在" }, { status: 404 });
  if (payload.event === "progress" || !Array.isArray(payload.items)) {
    const progress = Math.max(0, Math.min(100, Number(payload.progress ?? 0)));
    let liveViewUrl = "";
    let screenshotUrl = "";
    try {
      if (payload.liveViewUrl) liveViewUrl = validateAgentEndpoint(payload.liveViewUrl);
      if (payload.screenshotUrl) screenshotUrl = validateAgentEndpoint(payload.screenshotUrl);
    } catch { return Response.json({ error: "实时画面地址必须是公网 HTTPS" }, { status: 400 }); }
    const status = ["dispatched", "running", "waiting_login", "failed"].includes(String(payload.status)) ? String(payload.status) : "running";
    const now = new Date().toISOString();
    if (status === "running" && !liveViewUrl && !job.live_view_url) {
      await db.prepare("UPDATE connector_jobs SET status='failed', error=?, current_action=?, updated_at=? WHERE id=?")
        .bind("实时同屏未建立，已阻止 Agent 继续执行", "等待恢复电脑画面", now, payload.jobId).run();
      return Response.json({ error: "实时同屏是强制要求，请先恢复 liveViewUrl" }, { status: 409 });
    }
    await db.prepare(`UPDATE connector_jobs SET status=?, progress=?, current_action=?,
      live_view_url=CASE WHEN ?='' THEN live_view_url ELSE ? END,
      screenshot_url=CASE WHEN ?='' THEN screenshot_url ELSE ? END,
      error=?, updated_at=? WHERE id=? AND task_id=?`)
      .bind(status, progress, String(payload.action ?? "Agent 正在执行"), liveViewUrl, liveViewUrl,
        screenshotUrl, screenshotUrl, String(payload.error ?? ""), now, payload.jobId, payload.taskId).run();
    return Response.json({ ok: true, event: "progress", updatedAt: now });
  }
  if (payload.items.length > 500) return Response.json({ error: "单次回调最多 500 条" }, { status: 413 });
  const items = payload.items.map((item) => ({ ...item, source: payload.source! }));
  const stats = await ingestCandidates(db, task, items);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE connector_jobs SET status = ?, completed_at = ?, fetched = ?, error = ?, progress = 100, current_action = ?, updated_at = ? WHERE id = ? AND task_id = ?")
      .bind(payload.error ? "failed" : "completed", now, stats.fetched, payload.error ?? "", payload.error ? "执行失败" : "采集完成", now, payload.jobId, payload.taskId),
    db.prepare("UPDATE tasks SET discovered = discovered + ?, high_value = high_value + ?, last_run_at = ? WHERE id = ?")
      .bind(stats.valid, stats.highValue, now, payload.taskId),
  ]);
  return Response.json({ ok: true, ...stats });
}
