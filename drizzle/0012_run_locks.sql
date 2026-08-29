CREATE TABLE `task_run_locks` (
  `task_id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `acquired_at` text NOT NULL,
  `expires_at` text NOT NULL
);
