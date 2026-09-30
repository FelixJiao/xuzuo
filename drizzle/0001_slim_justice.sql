PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`parent_id` text,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`planned_date` text,
	`due_date` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`estimated_hours` real DEFAULT 0 NOT NULL,
	`actual_hours` real,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "project_id", "parent_id", "title", "notes", "planned_date", "due_date", "status", "estimated_hours", "actual_hours", "completed_at", "created_at", "updated_at") SELECT "id", "project_id", "parent_id", "title", "notes", "planned_date", "due_date", "status", "estimated_hours", "actual_hours", "completed_at", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_tasks_project_id` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_parent_id` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_planned_date` ON `tasks` (`planned_date`);--> statement-breakpoint
CREATE INDEX `idx_tasks_due_status` ON `tasks` (`due_date`,`status`);