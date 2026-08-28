import { parseDelimited, parseUrlLines, parseXlsx, validateImportRows } from "../../../../lib/connectors/import";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let rows;
    let fileName = "url-import.txt";
    let format = "url";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "请选择 CSV 或 XLSX 文件" }, { status: 400 });
      if (file.size > MAX_FILE_BYTES) return Response.json({ error: "文件不得超过 5MB" }, { status: 413 });
      fileName = file.name.slice(0, 240);
      const extension = file.name.toLowerCase().split(".").pop();
      if (extension === "xlsx") { rows = parseXlsx(new Uint8Array(await file.arrayBuffer())); format = "xlsx"; }
      else if (["csv", "tsv", "txt"].includes(extension ?? "")) { rows = parseDelimited(await file.text()); format = extension === "tsv" ? "tsv" : "csv"; }
      else return Response.json({ error: "仅支持 CSV、TSV、TXT 或 XLSX" }, { status: 415 });
    } else {
      const payload = await request.json() as { urlText?: string };
      rows = parseUrlLines(String(payload.urlText ?? ""));
    }
    const result = validateImportRows(rows);
    return Response.json({ fileName, format, total: result.total, accepted: result.valid.length, failed: result.errors.length, items: result.valid, errors: result.errors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "导入预览失败" }, { status: 400 });
  }
}
