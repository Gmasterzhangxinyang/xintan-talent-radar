export function escapeXml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function safeSpreadsheetText(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function spreadsheetCell(value: unknown, options?: { href?: string }) {
  const safe = safeSpreadsheetText(value);
  const href = options?.href && /^https?:\/\//i.test(options.href) ? ` ss:HRef="${escapeXml(options.href)}"` : "";
  return `<Cell${href}><Data ss:Type="String">${escapeXml(safe)}</Data></Cell>`;
}
