DELETE FROM sources WHERE name <> '知乎';
DELETE FROM leads WHERE source <> '知乎';
DELETE FROM raw_items WHERE source <> '知乎';
DELETE FROM connector_jobs WHERE source <> '知乎';

UPDATE tasks SET sources = '["知乎"]';
UPDATE connector_settings SET enabled_sources = '["知乎"]';
UPDATE task_filters
SET source_limits = json_object('知乎', COALESCE(json_extract(source_limits, '$.知乎'), 10));

INSERT OR REPLACE INTO sources (id, name, mode, status, last_check, coverage, note)
VALUES ('zhihu', '知乎', '本机浏览器 Agent', '待检测', '未执行', '公开问答、文章与评论', '复用本机知乎登录状态；逐条打开详情并由AI评估');
