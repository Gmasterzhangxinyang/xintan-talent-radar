import { parseStringArray } from "./json";

export const COMPUTER_AGENT_ID = "computer-agent";
export const COMPUTER_SOURCES = ["知乎"];

export type ConnectorSettingRow = {
  endpoint: string;
  token_secret: string;
  callback_secret_hash: string;
  enabled_sources: string;
  status: string;
  last_test_at: string | null;
  last_error: string;
  live_view_url: string;
  capabilities: string;
  updated_at: string;
};

export function validateAgentEndpoint(value: string) {
  if (!value) return "";
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("电脑助手地址格式不正确"); }
  if (url.protocol !== "https:") throw new Error("电脑助手连接地址必须使用安全 HTTPS");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "127.0.0.1" || host === "::1" ||
    /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error("云端暂时无法直连本机地址，请使用电脑助手提供的安全连接地址");
  }
  return url.toString().replace(/\/$/, "");
}

export async function hashSecret(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadConnectorSettings(db: D1Database) {
  const row = await db.prepare("SELECT * FROM connector_settings WHERE id = ?").bind(COMPUTER_AGENT_ID).first<ConnectorSettingRow>();
  return row ? {
    ...row,
    enabledSources: parseStringArray(row.enabled_sources).filter((source) => COMPUTER_SOURCES.includes(source)),
    parsedCapabilities: parseStringArray(row.capabilities),
  } : null;
}
