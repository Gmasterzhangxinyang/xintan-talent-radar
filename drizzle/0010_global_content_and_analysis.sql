ALTER TABLE `raw_items` RENAME TO `legacy_raw_items`;
--> statement-breakpoint
CREATE TABLE `raw_items` (
  `id` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL,
  `external_id` text DEFAULT '' NOT NULL,
  `canonical_url` text NOT NULL,
  `content_hash` text NOT NULL,
  `author` text DEFAULT '未公开' NOT NULL,
  `author_id` text DEFAULT '' NOT NULL,
  `author_profile_url` text DEFAULT '' NOT NULL,
  `published_at` text,
  `published_at_raw` text DEFAULT '' NOT NULL,
  `time_confidence` text DEFAULT 'unknown' NOT NULL,
  `title` text DEFAULT '' NOT NULL,
  `snippet` text NOT NULL,
  `full_text` text DEFAULT '' NOT NULL,
  `content_type` text DEFAULT 'post' NOT NULL,
  `raw_payload` text DEFAULT '{}' NOT NULL,
  `fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_raw_source_url` ON `raw_items` (`source`,`canonical_url`);
--> statement-breakpoint
CREATE INDEX `idx_raw_source_external` ON `raw_items` (`source`,`external_id`);
--> statement-breakpoint
CREATE INDEX `idx_raw_content_hash` ON `raw_items` (`content_hash`);
--> statement-breakpoint
CREATE INDEX `idx_raw_source_published` ON `raw_items` (`source`,`published_at`);
--> statement-breakpoint
INSERT INTO `raw_items` (
  id, source, external_id, canonical_url, content_hash, author, author_id,
  published_at, published_at_raw, time_confidence, snippet, full_text,
  raw_payload, fetched_at, updated_at
)
SELECT id, source, external_id, source_url, content_hash, author, author_id,
  CASE WHEN published_at = '未公开' THEN NULL ELSE published_at END,
  published_at,
  CASE WHEN published_at = '未公开' THEN 'unknown' ELSE 'medium' END,
  snippet, snippet, raw_payload, fetched_at, fetched_at
FROM (
  SELECT legacy_raw_items.*,
    ROW_NUMBER() OVER (PARTITION BY source, source_url ORDER BY fetched_at DESC, id ASC) AS row_number
  FROM legacy_raw_items
)
WHERE row_number = 1;
--> statement-breakpoint
CREATE TABLE `task_item_matches` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `raw_item_id` text NOT NULL,
  `matched_keywords` text DEFAULT '[]' NOT NULL,
  `match_score` integer DEFAULT 0 NOT NULL,
  `match_reason` text DEFAULT '' NOT NULL,
  `first_matched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_matched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_task_item_match` ON `task_item_matches` (`task_id`,`raw_item_id`);
--> statement-breakpoint
CREATE INDEX `idx_task_matches_raw` ON `task_item_matches` (`raw_item_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `task_item_matches` (id, task_id, raw_item_id, match_reason, first_matched_at, last_matched_at)
SELECT 'match-' || l.id, l.task_id, r.id, '旧数据迁移', l.fetched_at, l.fetched_at
FROM legacy_raw_items l
JOIN raw_items r ON r.source = l.source AND r.canonical_url = l.source_url;
--> statement-breakpoint
CREATE TABLE `analyses` (
  `id` text PRIMARY KEY NOT NULL,
  `raw_item_id` text NOT NULL,
  `model` text NOT NULL,
  `prompt_version` text NOT NULL,
  `taxonomy_version` text NOT NULL,
  `intelligence_type` text NOT NULL,
  `job_match_score` integer DEFAULT 0 NOT NULL,
  `job_intent_score` integer DEFAULT 0 NOT NULL,
  `company_intel_score` integer DEFAULT 0 NOT NULL,
  `identity_confidence` real DEFAULT 0 NOT NULL,
  `evidence_confidence` real DEFAULT 0 NOT NULL,
  `tags` text DEFAULT '[]' NOT NULL,
  `evidence_quotes` text DEFAULT '[]' NOT NULL,
  `summary` text DEFAULT '' NOT NULL,
  `uncertainty` text DEFAULT '[]' NOT NULL,
  `raw_output` text DEFAULT '{}' NOT NULL,
  `status` text NOT NULL,
  `error_code` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_analyses_raw_status_created` ON `analyses` (`raw_item_id`,`status`,`created_at`);
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `role_family` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `locations` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `seniority` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `query_groups` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `analysis_profile_id` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `scan_mode` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `last_successful_run_at` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `raw_item_id` text;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `analysis_id` text;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `lead_type` text DEFAULT 'uncertain' NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `job_match_score` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `intent_score` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `intel_score` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `identity_confidence` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `evidence_confidence` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `overall_score` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `review_note` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `reviewed_by` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `reviewed_at` text;
--> statement-breakpoint
UPDATE leads
SET raw_item_id = (
  SELECT r.id FROM raw_items r
  JOIN legacy_raw_items l ON l.source = r.source AND l.source_url = r.canonical_url
  WHERE l.task_id = leads.task_id AND l.source = leads.source AND l.source_url = leads.url
  LIMIT 1
),
lead_type = CASE intelligence_type WHEN '人才线索' THEN 'talent' WHEN '企业情报' THEN 'company_intelligence' ELSE 'uncertain' END,
job_match_score = CASE WHEN intelligence_type = '人才线索' THEN score ELSE 0 END,
intent_score = CASE intent WHEN '强' THEN 85 WHEN '中' THEN 55 ELSE 0 END,
intel_score = CASE WHEN intelligence_type = '企业情报' THEN score ELSE 0 END,
overall_score = score,
review_status = CASE review_status WHEN '已确认' THEN 'confirmed' WHEN '误报' THEN 'false_positive' ELSE 'pending' END;
--> statement-breakpoint
CREATE INDEX `idx_leads_review_created` ON `leads` (`review_status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_leads_raw_item` ON `leads` (`raw_item_id`);
--> statement-breakpoint
CREATE TABLE `run_source_stats` (
  `run_id` text NOT NULL,
  `source` text NOT NULL,
  `status` text NOT NULL,
  `discovered` integer DEFAULT 0 NOT NULL,
  `time_filtered` integer DEFAULT 0 NOT NULL,
  `blacklist_filtered` integer DEFAULT 0 NOT NULL,
  `advertisement_filtered` integer DEFAULT 0 NOT NULL,
  `deduped` integer DEFAULT 0 NOT NULL,
  `matched` integer DEFAULT 0 NOT NULL,
  `analyzed` integer DEFAULT 0 NOT NULL,
  `kept` integer DEFAULT 0 NOT NULL,
  `failed` integer DEFAULT 0 NOT NULL,
  `started_at` text NOT NULL,
  `finished_at` text,
  `error_code` text DEFAULT '' NOT NULL,
  `error_message` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_run_source_stats` ON `run_source_stats` (`run_id`,`source`);
--> statement-breakpoint
CREATE TABLE `run_events` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `level` text NOT NULL,
  `stage` text NOT NULL,
  `source` text DEFAULT '' NOT NULL,
  `message` text NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_run_events_run_created` ON `run_events` (`run_id`,`created_at`);
