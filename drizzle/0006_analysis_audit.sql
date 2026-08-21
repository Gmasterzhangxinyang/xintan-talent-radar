ALTER TABLE `connector_jobs` ADD COLUMN `phase` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD COLUMN `inspected` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD COLUMN `kept` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD COLUMN `filtered` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD COLUMN `current_item` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `connector_jobs` ADD COLUMN `analysis_trace` text DEFAULT '[]' NOT NULL;
