import { importTemplateCsv } from "../../../../lib/connectors/import";

export async function GET() {
  return new Response(`\uFEFF${importTemplateCsv()}`, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="xintan-import-template.csv"',
    "Cache-Control": "no-store",
  } });
}
