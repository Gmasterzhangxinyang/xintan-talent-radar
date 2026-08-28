import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { importTemplateCsv, parseDelimited, parseUrlLines, parseXlsx, validateImportRows } from "../../lib/connectors/import";

test("maps Chinese and English CSV headers and keeps quoted commas", () => {
  const rows = parseDelimited('来源,URL,作者,发布时间,原文片段,备注\n知乎,https://www.zhihu.com/question/1,公开作者,2026-08-20T08:00:00.000Z,"UVM, VCS 项目经验",优先复核');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "知乎");
  assert.equal(rows[0].snippet, "UVM, VCS 项目经验");
  assert.equal(rows[0].note, "优先复核");
});

test("validates rows independently so one error does not block valid rows", () => {
  const rows = parseDelimited("source,url,snippet\n知乎,https://www.zhihu.com/question/1,UVM经验\n知乎,not-a-url,另一条内容\n知乎,https://www.zhihu.com/question/3,");
  const result = validateImportRows(rows);
  assert.equal(result.valid.length, 1);
  assert.deepEqual(result.errors.map((error) => error.code), ["invalid_url", "missing_content"]);
});

test("supports URL plus snippet lines and provides a bilingual template", () => {
  const rows = parseUrlLines("https://www.zhihu.com/question/1 | 一段公开原文");
  assert.equal(rows[0].source, "知乎");
  assert.equal(validateImportRows(rows).valid.length, 1);
  assert.match(importTemplateCsv(), /^source,url,author,author_id,published_at,title,snippet,full_text,note/m);
});

test("parses the first XLSX worksheet with shared strings", () => {
  const shared = `<?xml version="1.0"?><sst><si><t>来源</t></si><si><t>URL</t></si><si><t>原文片段</t></si><si><t>知乎</t></si><si><t>https://www.zhihu.com/question/8</t></si><si><t>公开内容</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row></sheetData></worksheet>`;
  const bytes = zipSync({ "xl/sharedStrings.xml": strToU8(shared), "xl/worksheets/sheet1.xml": strToU8(sheet) });
  const rows = parseXlsx(bytes);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "https://www.zhihu.com/question/8");
  assert.equal(rows[0].snippet, "公开内容");
});
