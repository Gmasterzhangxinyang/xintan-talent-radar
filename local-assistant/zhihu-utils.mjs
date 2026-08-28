export function parseVisibleDate(value, now = new Date()) {
  const text = String(value || "").replace(/^(?:发布于|编辑于|更新于|最后编辑于)\s*/, "").trim();
  if (!text || text === "未公开") return null;
  if (/刚刚/.test(text)) return new Date(now);
  const relative = text.match(/(\d+)\s*(分钟前|小时前|天前)/);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = relative[2] === "分钟前" ? 60_000 : relative[2] === "小时前" ? 3_600_000 : 86_400_000;
    return new Date(now.getTime() - amount * unitMs);
  }
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;
  const normalized = text.replace(/[年月]/g, "-").replace(/日/g, "").replace(/\//g, "-").replace(/(\d)\.(?=\d{1,2}(?:\D|$))/g, "$1-");
  if (/^\d{1,2}-\d{1,2}/.test(normalized)) {
    const date = new Date(`${now.getFullYear()}-${normalized}`);
    if (!Number.isNaN(date.getTime())) {
      if (date.getTime() > now.getTime() + 86_400_000) date.setFullYear(date.getFullYear() - 1);
      return date;
    }
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isZhihuContentUrl(value) {
  try {
    const parsed = value instanceof URL ? value : new URL(String(value));
    const host = parsed.hostname.replace(/^www\./, "");
    return (host === "zhihu.com" || host.endsWith(".zhihu.com")) && (/\/(question|p)\//.test(parsed.pathname) || /\/answer\//.test(parsed.pathname));
  } catch { return false; }
}
