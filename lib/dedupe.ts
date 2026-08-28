export function normalizeContent(value: string) {
  return value.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[，。！？、,.!?;；:：]/g, "").replace(/\s+/g, "").trim();
}

export async function contentHash(source: string, snippet: string, url: string) {
  const parsed = new URL(url);
  const input = `${source}|${normalizeContent(snippet)}|${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, "")}`;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
