import { foreignKey, index, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  color: text('color').notNull().default('#e86d4d'),
  icon: text('icon').notNull().default('◇'),
  status: text('status', { enum: ['active', 'paused', 'completed'] }).notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  notes: text('notes').notNull().default(''),
  plannedDate: text('planned_date'),
  dueDate: text('due_date'),
  status: text('status', { enum: ['todo', 'in_progress', 'done'] }).notNull().default('todo'),
  estimatedHours: real('estimated_hours').notNull().default(0),
  actualHours: real('actual_hours'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: 'tasks_parent_id_tasks_id_fk',
  }).onDelete('cascade'),
  index('idx_tasks_project_id').on(table.projectId),
  index('idx_tasks_parent_id').on(table.parentId),
  index('idx_tasks_planned_date').on(table.plannedDate),
  index('idx_tasks_due_status').on(table.dueDate, table.status),
]);

export const dailyReports = sqliteTable('daily_reports', {
  id: text('id').primaryKey(),
  reportDate: text('report_date').notNull(),
  summary: text('summary').notNull(),
  tomorrowPlan: text('tomorrow_plan').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('idx_daily_reports_date').on(table.reportDate)]);
