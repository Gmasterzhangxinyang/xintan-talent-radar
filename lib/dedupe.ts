export function normalizeContent(value: string) {
  return value.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").replace(/[，。！？、,.!?;；:：]/g, "").trim();
}

export async function contentHash(taskId: string, source: string, snippet: string, url: string) {
  const input = `${taskId}|${source}|${normalizeContent(snippet)}|${new URL(url).pathname.replace(/\/$/, "")}`;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
