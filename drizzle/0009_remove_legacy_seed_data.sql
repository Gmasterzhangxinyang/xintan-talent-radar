-- Remove only the exact validation fixtures introduced by migration 0001.
-- User-created or edited records are not matched by these predicates.
DELETE FROM leads
WHERE id IN ('lead-1', 'lead-3', 'lead-4', 'lead-5', 'lead-6');
--> statement-breakpoint
DELETE FROM runs
WHERE id IN ('run-1', 'run-2', 'run-3');
--> statement-breakpoint
DELETE FROM task_filters
WHERE task_id IN (
  SELECT id FROM tasks
  WHERE (id = 'task-gpu' AND created_at = '2026-08-17T06:20:00.000Z')
     OR (id = 'task-pd' AND created_at = '2026-08-17T06:21:00.000Z')
     OR (id = 'task-company' AND created_at = '2026-08-17T06:22:00.000Z')
);
--> statement-breakpoint
DELETE FROM tasks
WHERE (id = 'task-gpu' AND created_at = '2026-08-17T06:20:00.000Z')
   OR (id = 'task-pd' AND created_at = '2026-08-17T06:21:00.000Z')
   OR (id = 'task-company' AND created_at = '2026-08-17T06:22:00.000Z');
