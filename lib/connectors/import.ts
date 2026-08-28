import { strFromU8, unzipSync } from "fflate";
import type { CandidateItem } from "../types";

export const IMPORT_HEADERS = ["source", "url", "author", "author_id", "published_at", "title", "snippet", "full_text", "note"] as const;
type ImportHeader = typeof IMPORT_HEADERS[number];
export type ImportRow = Partial<Record<ImportHeader, string>> & { rowNumber: number };
export type ImportRowError = { rowNumber: number; code: string; message: string };

const HEADER_ALIASES: Record<string, ImportHeader> = {
  source: "source", 来源: "source", 来源平台: "source",
  url: "url", 链接: "url", 来源url: "url", 原始链接: "url",
  author: "author", 作者: "author", 作者昵称: "author", 公开昵称: "author",
  author_id: "author_id", authorid: "author_id", 作者id: "author_id", 公开id: "author_id",
  published_at: "published_at", publishedat: "published_at", 发布时间: "published_at", 时间: "published_at",
  title: "title", 标题: "title",
  snippet: "snippet", 原文片段: "snippet", 摘要: "snippet", 内容: "snippet",
  full_text: "full_text", fulltext: "full_text", 正文: "full_text", 完整正文: "full_text",
  note: "note", 备注: "note",
};

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

function mapRows(rows: string[][]): ImportRow[] {
  const headers = (rows[0] ?? []).map((header) => HEADER_ALIASES[normalizeHeader(header)]);
  return rows.slice(1).map((cells, index) => {
    const row: ImportRow = { rowNumber: index + 2 };
    headers.forEach((header, column) => { if (header) row[header] = String(cells[column] ?? "").trim(); });
    return row;
  }).filter((row) => IMPORT_HEADERS.some((header) => Boolean(row[header])));
}

export function parseDelimited(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return mapRows(rows);
}

function columnIndex(reference: string) {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export function parseXlsx(bytes: Uint8Array) {
  const archive = unzipSync(bytes);
  const sharedXml = archive["xl/sharedStrings.xml"] ? strFromU8(archive["xl/sharedStrings.xml"]) : "";
  const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    decodeXml([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")),
  );
  const sheetKey = Object.keys(archive).filter((key) => /^xl\/worksheets\/sheet\d+\.xml$/.test(key)).sort()[0];
  if (!sheetKey) throw new Error("xlsx_missing_worksheet");
  const sheet = strFromU8(archive[sheetKey]);
  const rows = [...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells: string[] = [];
    for (const match of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = match[1].match(/\br="([A-Z]+\d+)"/i)?.[1] ?? "A1";
      const type = match[1].match(/\bt="([^"]+)"/i)?.[1] ?? "";
      const value = match[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? match[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      cells[columnIndex(reference)] = type === "s" ? sharedStrings[Number(value)] ?? "" : decodeXml(value);
    }
    return cells;
  });
  return mapRows(rows);
}

export function parseUrlLines(text: string): ImportRow[] {
  return text.split(/\r?\n/).map((line, index) => {
    const [url = "", snippet = "", author = "", publishedAt = ""] = line.split(/\t|\s+\|\s+/);
    return { rowNumber: index + 1, source: inferSource(url), url: url.trim(), snippet: snippet.trim(), author: author.trim(), published_at: publishedAt.trim() };
  }).filter((row) => row.url);
}

export function inferSource(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "zhihu.com" || host.endsWith(".zhihu.com")) return "知乎";
    return "导入";
  } catch { return ""; }
}

export function validateImportRows(rows: ImportRow[]) {
  const errors: ImportRowError[] = [];
  const valid: CandidateItem[] = [];
  rows.slice(0, 2_000).forEach((row) => {
    let url: URL;
    try { url = new URL(row.url ?? ""); } catch { errors.push({ rowNumber: row.rowNumber, code: "invalid_url", message: "URL 格式无效" }); return; }
    if (!["http:", "https:"].includes(url.protocol)) { errors.push({ rowNumber: row.rowNumber, code: "invalid_url_protocol", message: "URL 只允许 HTTP/HTTPS" }); return; }
    const snippet = (row.snippet || row.full_text || "").trim();
    if (!snippet) { errors.push({ rowNumber: row.rowNumber, code: "missing_content", message: "需要提供原文片段或正文" }); return; }
    const publishedAt = row.published_at?.trim();
    if (publishedAt && Number.isNaN(Date.parse(publishedAt))) { errors.push({ rowNumber: row.rowNumber, code: "invalid_published_at", message: "发布时间无法识别" }); return; }
    valid.push({
      source: row.source?.trim() || inferSource(url.toString()) || "导入", externalId: url.toString(), url: url.toString(),
      author: row.author?.trim(), authorId: row.author_id?.trim(), publishedAt: publishedAt || undefined,
      publishedAtRaw: publishedAt, timeConfidence: publishedAt ? "high" : "unknown", title: row.title?.trim(),
      snippet: snippet.slice(0, 5_000), fullText: (row.full_text || snippet).trim().slice(0, 20_000), contentType: "post",
      raw: { importNote: row.note?.trim() ?? "", importRowNumber: row.rowNumber },
    });
  });
  return { valid, errors, total: rows.length };
}

export function importTemplateCsv() {
  return `${IMPORT_HEADERS.join(",")}\n知乎,https://www.zhihu.com/question/123,公开昵称,公开ID,2026-08-28T08:00:00.000Z,标题,公开原文片段,可选完整正文,可选备注\n`;
}
