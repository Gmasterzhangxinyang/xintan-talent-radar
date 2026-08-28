import { ensureDatabase, getD1 } from "../../../db/bootstrap";
import { spreadsheetCell } from "../../../lib/export";

export async function GET(request: Request) {
  await ensureDatabase();
  const url = new URL(request.url);
  const where: string[] = [];
  const values: string[] = [];
  for (const [parameter, column] of [["source", "l.source"], ["type", "l.intelligence_type"], ["priority", "l.priority"], ["taskId", "l.task_id"], ["intent", "l.intent"], ["status", "l.review_status"]] as const) {
    const value = url.searchParams.get(parameter);
    const statusMap: Record<string, string> = { 待审核: "pending", 已确认: "confirmed", 误报: "false_positive", 已忽略: "ignored", 稍后处理: "follow_up_later" };
    if (value) { where.push(`${column} = ?`); values.push(parameter === "status" ? statusMap[value] ?? value : value); }
  }
  const query = `SELECT l.*, t.name AS task_name, r.time_confidence, a.evidence_quotes, a.uncertainty
    FROM leads l
    LEFT JOIN tasks t ON t.id = l.task_id
    LEFT JOIN raw_items r ON r.id = l.raw_item_id
    LEFT JOIN analyses a ON a.id = l.analysis_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY l.overall_score DESC, l.published_at DESC`;
  const rows = await getD1().prepare(query).bind(...values).all<Record<string, unknown>>();
  const headers = ["任务名称", "线索类型", "来源", "来源URL", "发布时间", "时间可信度", "作者公开昵称", "作者公开ID", "原文片段", "AI标签", "岗位匹配分", "求职意向等级", "求职意向分", "企业情报类型", "企业情报分", "AI证据", "AI不确定项", "综合优先级", "人工状态", "企业情报备注", "人工备注", "入库时间"];
  const reviewLabels: Record<string, string> = { pending: "待审核", confirmed: "已确认", false_positive: "误报", ignored: "已忽略", follow_up_later: "稍后处理" };
  const parseList = (value: unknown) => { try { const parsed = JSON.parse(String(value ?? "[]")); return Array.isArray(parsed) ? parsed.join("；") : String(value ?? ""); } catch { return String(value ?? ""); } };
  const body = rows.results.map((row) => [row.task_name, row.lead_type, row.source, row.url, row.published_at, row.time_confidence,
    row.author, row.author_id, row.snippet, parseList(row.tags), row.job_match_score, row.intent, row.intent_score,
    row.intelligence_type, row.intel_score, parseList(row.evidence_quotes) || row.evidence, parseList(row.uncertainty), row.priority,
    reviewLabels[String(row.review_status)] ?? row.review_status, row.company_note, row.review_note, row.created_at]);
  const rowsXml = [`<Row>${headers.map((cell) => spreadsheetCell(cell)).join("")}</Row>`, ...body.map((row) => `<Row>${row.map((cell, index) => spreadsheetCell(cell, index === 3 ? { href: String(cell ?? "") } : undefined)).join("")}</Row>`)].join("");
  const filterDescription = [...url.searchParams.entries()].map(([key, value]) => `${key}=${value}`).join("；") || "无筛选";
  const metadataXml = `<Row>${spreadsheetCell("导出时间")}${spreadsheetCell(new Date().toISOString())}</Row><Row>${spreadsheetCell("筛选条件")}${spreadsheetCell(filterDescription)}</Row>`;
  const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="线索"><Table>${rowsXml}</Table></Worksheet><Worksheet ss:Name="导出信息"><Table>${metadataXml}</Table></Worksheet></Workbook>`;
  return new Response(workbook, { headers: {
    "Content-Type": "application/vnd.ms-excel; charset=utf-8",
    "Content-Disposition": `attachment; filename="xintan-leads-${new Date().toISOString().slice(0, 10)}.xls"`,
  } });
}
