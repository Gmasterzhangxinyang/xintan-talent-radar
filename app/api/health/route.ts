import { env } from "cloudflare:workers";
import { ensureDatabase, getD1 } from "../../../db/bootstrap";
import { loadConnectorSettings } from "../../../lib/connector-settings";

export async function GET() {
  try {
    await ensureDatabase();
    const db = getD1();
    const [check, settings] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM tasks").first<{ count: number }>(),
      loadConnectorSettings(db),
    ]);
    const config = env as unknown as Record<string, unknown>;
    const computerAgentConfigured = Boolean(settings?.endpoint) || (typeof config.COMPUTER_AGENT_URL === "string" && Boolean(config.COMPUTER_AGENT_URL));
    return Response.json({
      status: computerAgentConfigured ? "operational" : "core_operational_connectors_pending",
      database: "connected",
      tasks: check?.count ?? 0,
      computerAgentConfigured,
      schedulerConfigured: typeof config.SCHEDULER_SECRET === "string" && Boolean(config.SCHEDULER_SECRET),
      checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ status: "unhealthy", database: "unavailable", error: error instanceof Error ? error.message : "health check failed" }, { status: 503 });
  }
}
