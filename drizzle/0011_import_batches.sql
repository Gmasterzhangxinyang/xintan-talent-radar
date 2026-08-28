CREATE TABLE `import_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `file_name` text DEFAULT '' NOT NULL,
  `format` text NOT NULL,
  `status` text NOT NULL,
  `total` integer DEFAULT 0 NOT NULL,
  `accepted` integer DEFAULT 0 NOT NULL,
  `duplicated` integer DEFAULT 0 NOT NULL,
  `filtered` integer DEFAULT 0 NOT NULL,
  `failed` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_import_batches_task_created` ON `import_batches` (`task_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `import_rows` (
  `id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL,
  `row_number` integer NOT NULL,
  `status` text NOT NULL,
  `error_code` text DEFAULT '' NOT NULL,
  `error_message` text DEFAULT '' NOT NULL,
  `raw_item_id` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_import_rows_batch_row` ON `import_rows` (`batch_id`,`row_number`);
