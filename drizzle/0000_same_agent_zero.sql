CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`source` text NOT NULL,
	`author` text NOT NULL,
	`author_id` text DEFAULT '' NOT NULL,
	`published_at` text NOT NULL,
	`snippet` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`intent` text DEFAULT '无' NOT NULL,
	`intelligence_type` text DEFAULT '人才线索' NOT NULL,
	`priority` text DEFAULT 'C' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`company_note` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`review_status` text DEFAULT '待审核' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_leads_task_priority` ON `leads` (`task_id`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_leads_source_published` ON `leads` (`source`,`published_at`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`task_name` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`fetched` integer DEFAULT 0 NOT NULL,
	`filtered` integer DEFAULT 0 NOT NULL,
	`deduped` integer DEFAULT 0 NOT NULL,
	`valid` integer DEFAULT 0 NOT NULL,
	`high_value` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_runs_task_started` ON `runs` (`task_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`last_check` text NOT NULL,
	`coverage` text NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`jd` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`tech_keywords` text DEFAULT '[]' NOT NULL,
	`company_keywords` text DEFAULT '[]' NOT NULL,
	`signal_keywords` text DEFAULT '[]' NOT NULL,
	`exclude_keywords` text DEFAULT '[]' NOT NULL,
	`schedule` text DEFAULT '每天 09:00' NOT NULL,
	`time_range` text DEFAULT '近30天' NOT NULL,
	`discovered` integer DEFAULT 0 NOT NULL,
	`high_value` integer DEFAULT 0 NOT NULL,
	`last_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status_created` ON `tasks` (`status`,`created_at`);