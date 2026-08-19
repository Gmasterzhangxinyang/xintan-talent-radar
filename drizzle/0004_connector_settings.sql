CREATE TABLE IF NOT EXISTS `connector_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `endpoint` text DEFAULT '' NOT NULL,
  `token_secret` text DEFAULT '' NOT NULL,
  `callback_secret_hash` text DEFAULT '' NOT NULL,
  `enabled_sources` text DEFAULT '[]' NOT NULL,
  `status` text DEFAULT 'not_configured' NOT NULL,
  `last_test_at` text,
  `last_error` text DEFAULT '' NOT NULL,
  `live_view_url` text DEFAULT '' NOT NULL,
  `capabilities` text DEFAULT '[]' NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD `progress` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD `current_action` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD `live_view_url` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD `screenshot_url` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD `updated_at` text DEFAULT '' NOT NULL;
