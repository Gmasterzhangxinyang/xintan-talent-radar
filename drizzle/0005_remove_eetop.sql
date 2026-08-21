DELETE FROM sources WHERE name = 'EETOP' OR id = 'eetop';
--> statement-breakpoint
DELETE FROM leads WHERE source = 'EETOP';
--> statement-breakpoint
DELETE FROM raw_items WHERE source = 'EETOP';
--> statement-breakpoint
DELETE FROM connector_jobs WHERE source = 'EETOP';
--> statement-breakpoint
UPDATE tasks
SET sources = COALESCE(
  (SELECT json_group_array(value) FROM json_each(tasks.sources) WHERE value <> 'EETOP'),
  '[]'
)
WHERE sources LIKE '%EETOP%';
--> statement-breakpoint
UPDATE connector_settings
SET enabled_sources = COALESCE(
  (SELECT json_group_array(value) FROM json_each(connector_settings.enabled_sources) WHERE value <> 'EETOP'),
  '[]'
)
WHERE enabled_sources LIKE '%EETOP%';
