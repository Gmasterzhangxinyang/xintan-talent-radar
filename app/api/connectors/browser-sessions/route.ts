import { ensureDatabase, getD1 } from "../../../../db/bootstrap";
import { COMPUTER_SOURCES, loadConnectorSettings } from "../../../../lib/connector-settings";

type AgentSession = { platform?: string; status?: string; profileName?: string; lastCheckedAt?: string };

function authHeaders(token: string, json = false) {
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export async function GET() {
  await ensureDatabase();
  const db = getD1();
  const settings = await loadConnectorSettings(db);
  if (!settings?.endpoint) return Response.json({ error: "请先启动并连接本地电脑助手" }, { status: 400 });
  try {
    const response = await fetch(`${settings.endpoint}/v1/browser-sessions`, {
      headers: authHeaders(settings.token_secret), signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) return Response.json({ error: "当前电脑助手不支持登录状态检测" }, { status: 501 });
    if (!response.ok) throw new Error(`电脑助手返回 HTTP ${response.status}`);
    const payload = await response.json() as { sessions?: AgentSession[] };
    const sessions = COMPUTER_SOURCES.map((platform) => {
      const session = payload.sessions?.find((item) => item.platform === platform);
      const status = ["logged_in", "logged_out", "expired", "checking"].includes(String(session?.status)) ? String(session?.status) : "unknown";
      return { platform, status, profileName: String(session?.profileName ?? ""), lastCheckedAt: String(session?.lastCheckedAt ?? "") };
    });
    const now = new Date().toISOString();
    await db.batch(sessions.map((session) => db.prepare("UPDATE sources SET status=?, last_check=?, note=? WHERE name=?")
      .bind(session.status === "logged_in" ? "已登录" : session.status === "checking" ? "检测中" : "需登录", now,
        session.status === "logged_in" ? "复用电脑浏览器现有登录会话" : "请先在电脑浏览器中完成平台登录", session.platform)));
    return Response.json({ ok: true, sessions, checkedAt: now });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "登录状态检测失败" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  await ensureDatabase();
  const settings = await loadConnectorSettings(getD1());
  if (!settings?.endpoint) return Response.json({ error: "请先启动并连接本地电脑助手" }, { status: 400 });
  const payload = await request.json() as { platform?: string };
  const platform = String(payload.platform ?? "");
  if (!COMPUTER_SOURCES.includes(platform)) return Response.json({ error: "不支持的平台" }, { status: 400 });
  try {
    const response = await fetch(`${settings.endpoint}/v1/browser-sessions/open`, {
      method: "POST", headers: authHeaders(settings.token_secret, true),
      body: JSON.stringify({ platform, mode: "interactive", reuseExistingProfile: true }),
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) return Response.json({ error: "当前电脑助手不支持打开登录页面" }, { status: 501 });
    if (!response.ok) throw new Error(`电脑助手返回 HTTP ${response.status}`);
    return Response.json({ ok: true, message: `已通知电脑打开${platform}，请在电脑上完成登录` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法通知电脑打开平台" }, { status: 502 });
  }
}
