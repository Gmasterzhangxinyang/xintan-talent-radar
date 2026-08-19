import { ensureDatabase, getD1 } from "../../../../db/bootstrap";
import { COMPUTER_AGENT_ID, COMPUTER_SOURCES, hashSecret, loadConnectorSettings, validateAgentEndpoint } from "../../../../lib/connector-settings";

export async function GET() {
  await ensureDatabase();
  const settings = await loadConnectorSettings(getD1());
  return Response.json({
    endpoint: settings?.endpoint ?? "",
    hasToken: Boolean(settings?.token_secret),
    hasCallbackSecret: Boolean(settings?.callback_secret_hash),
    enabledSources: settings ? settings.enabledSources : COMPUTER_SOURCES,
    status: settings?.status ?? "not_configured",
    lastTestAt: settings?.last_test_at ?? null,
    lastError: settings?.last_error ?? "",
    liveViewUrl: settings?.live_view_url ?? "",
    capabilities: settings?.parsedCapabilities ?? [],
    updatedAt: settings?.updated_at ?? null,
  });
}

export async function PUT(request: Request) {
  await ensureDatabase();
  const payload = await request.json() as { endpoint?: string; token?: string; callbackSecret?: string; enabledSources?: string[] };
  let endpoint = "";
  try { endpoint = validateAgentEndpoint(String(payload.endpoint ?? "").trim()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Agent 地址无效" }, { status: 400 }); }
  const enabledSources = Array.isArray(payload.enabledSources)
    ? [...new Set(payload.enabledSources.filter((source) => COMPUTER_SOURCES.includes(source)))]
    : COMPUTER_SOURCES;
  const token = String(payload.token ?? "").trim();
  const callbackSecret = String(payload.callbackSecret ?? "").trim();
  if (token.length > 2_000 || callbackSecret.length > 500) return Response.json({ error: "密钥长度超出限制" }, { status: 400 });
  const callbackHash = callbackSecret ? await hashSecret(callbackSecret) : "";
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO connector_settings
    (id, endpoint, token_secret, callback_secret_hash, enabled_sources, status, last_error, live_view_url, capabilities, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '', '', '[]', ?)
    ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,
      token_secret=CASE WHEN excluded.token_secret='' THEN connector_settings.token_secret ELSE excluded.token_secret END,
      callback_secret_hash=CASE WHEN excluded.callback_secret_hash='' THEN connector_settings.callback_secret_hash ELSE excluded.callback_secret_hash END,
      enabled_sources=excluded.enabled_sources, status=excluded.status, last_error='', updated_at=excluded.updated_at`)
    .bind(COMPUTER_AGENT_ID, endpoint, token, callbackHash, JSON.stringify(enabledSources), endpoint ? "saved" : "not_configured", now).run();
  if (!endpoint) {
    await getD1().prepare("UPDATE sources SET status='待配置', last_check='未执行' WHERE id IN ('douyin','weibo','xiaohongshu','zhihu')").run();
  }
  return Response.json({ ok: true });
}

export async function POST() {
  await ensureDatabase();
  const db = getD1();
  const settings = await loadConnectorSettings(db);
  if (!settings?.endpoint) return Response.json({ error: "请先保存 Agent 地址" }, { status: 400 });
  const now = new Date().toISOString();
  try {
    const response = await fetch(`${settings.endpoint}/health`, {
      headers: settings.token_secret ? { Authorization: `Bearer ${settings.token_secret}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Agent 健康检查返回 HTTP ${response.status}`);
    const health = await response.json().catch(() => ({})) as { liveViewUrl?: string; viewerUrl?: string; capabilities?: string[] };
    const requestedLiveUrl = String(health.liveViewUrl ?? health.viewerUrl ?? "");
    const liveViewUrl = requestedLiveUrl ? validateAgentEndpoint(requestedLiveUrl) : "";
    const capabilities = Array.isArray(health.capabilities) ? health.capabilities.filter((item) => typeof item === "string").slice(0, 20) : [];
    await db.batch([
      db.prepare("UPDATE connector_settings SET status='connected', last_test_at=?, last_error='', live_view_url=?, capabilities=?, updated_at=? WHERE id=?")
        .bind(now, liveViewUrl, JSON.stringify(capabilities), now, COMPUTER_AGENT_ID),
      db.prepare("UPDATE sources SET status='已连接', last_check=?, note='电脑 Agent 健康检查通过' WHERE id IN ('douyin','weibo','xiaohongshu','zhihu')").bind(now),
    ]);
    return Response.json({ ok: true, status: "connected", message: "连接成功，Agent 健康检查通过", testedAt: now, liveViewUrl, capabilities });
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    await db.batch([
      db.prepare("UPDATE connector_settings SET status='failed', last_test_at=?, last_error=?, updated_at=? WHERE id=?").bind(now, message, now, COMPUTER_AGENT_ID),
      db.prepare("UPDATE sources SET status='连接失败', last_check=?, note=? WHERE id IN ('douyin','weibo','xiaohongshu','zhihu')").bind(now, message),
    ]);
    return Response.json({ error: message, status: "failed", testedAt: now }, { status: 502 });
  }
}
