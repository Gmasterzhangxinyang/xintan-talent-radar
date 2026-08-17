import { ensureDatabase, getD1 } from "../../../db/bootstrap";

function xml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function GET(request: Request) {
  await ensureDatabase();
  const url = new URL(request.url);
  const where: string[] = [];
  const values: string[] = [];
  for (const [parameter, column] of [["source", "source"], ["type", "intelligence_type"], ["priority", "priority"]] as const) {
    const value = url.searchParams.get(parameter);
    if (value) { where.push(`${column} = ?`); values.push(value); }
  }
  const query = `SELECT * FROM leads ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY score DESC, published_at DESC`;
  const rows = await getD1().prepare(query).bind(...values).all<Record<string, unknown>>();
  const headers = ["来源平台", "来源URL", "发布时间", "作者公开昵称", "作者公开ID", "原文片段", "AI提取标签", "求职意向等级", "线索类型", "优先级", "匹配度", "企业情报备注", "处理状态"];
  const body = rows.results.map((row) => [row.source, row.url, row.published_at, row.author, row.author_id, row.snippet,
    (() => { try { return JSON.parse(String(row.tags)).join("、"); } catch { return row.tags; } })(), row.intent, row.intelligence_type,
    row.priority, row.score, row.company_note, row.review_status]);
  const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="线索"><Table>${[headers, ...body].map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${xml(cell)}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;
  return new Response(workbook, { headers: {
    "Content-Type": "application/vnd.ms-excel; charset=utf-8",
    "Content-Disposition": `attachment; filename="xintan-leads-${new Date().toISOString().slice(0, 10)}.xls"`,
  } });
}
