CREATE TABLE `daily_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`report_date` text NOT NULL,
	`summary` text NOT NULL,
	`tomorrow_plan` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_daily_reports_date` ON `daily_reports` (`report_date`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#e86d4d' NOT NULL,
	`icon` text DEFAULT '◇' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
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
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_project_id` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_parent_id` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_planned_date` ON `tasks` (`planned_date`);--> statement-breakpoint
CREATE INDEX `idx_tasks_due_status` ON `tasks` (`due_date`,`status`);