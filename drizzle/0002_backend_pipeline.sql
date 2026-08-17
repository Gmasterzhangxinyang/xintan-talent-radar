CREATE TABLE IF NOT EXISTS `task_filters` (
  `task_id` text PRIMARY KEY NOT NULL,
  `author_blacklist` text DEFAULT '[]' NOT NULL,
  `company_blacklist` text DEFAULT '[]' NOT NULL,
  `schedule_enabled` integer DEFAULT 1 NOT NULL,
  `next_run_at` text,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `raw_items` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `source` text NOT NULL,
  `external_id` text DEFAULT '' NOT NULL,
  `content_hash` text NOT NULL,
  `author` text DEFAULT '未公开' NOT NULL,
  `author_id` text DEFAULT '' NOT NULL,
  `published_at` text NOT NULL,
  `source_url` text NOT NULL,
  `snippet` text NOT NULL,
  `raw_payload` text DEFAULT '{}' NOT NULL,
  `fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_raw_task_hash` ON `raw_items` (`task_id`,`content_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_raw_task_fetched` ON `raw_items` (`task_id`,`fetched_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `connector_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `source` text NOT NULL,
  `status` text NOT NULL,
  `dispatched_at` text NOT NULL,
  `completed_at` text,
  `fetched` integer DEFAULT 0 NOT NULL,
  `error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_connector_jobs_task_status` ON `connector_jobs` (`task_id`,`status`);
