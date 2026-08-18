import { env } from "cloudflare:workers";
import { ensureDatabase, getD1 } from "../../../db/bootstrap";

export async function GET() {
  try {
    await ensureDatabase();
    const check = await getD1().prepare("SELECT COUNT(*) AS count FROM tasks").first<{ count: number }>();
    const config = env as unknown as Record<string, unknown>;
    const computerAgentConfigured = typeof config.COMPUTER_AGENT_URL === "string" && Boolean(config.COMPUTER_AGENT_URL);
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
