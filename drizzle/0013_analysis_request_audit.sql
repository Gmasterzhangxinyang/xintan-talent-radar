ALTER TABLE `analyses` ADD COLUMN `response_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `analyses` ADD COLUMN `latency_ms` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `analyses` ADD COLUMN `retry_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `analyses` ADD COLUMN `recommended_action` text DEFAULT 'human_review' NOT NULL;
