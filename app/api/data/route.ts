import { env } from '../../../server/sqlite-d1';
import { NextRequest, NextResponse } from 'next/server';

type Entity = 'project' | 'task' | 'report';

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#e86d4d',
    icon TEXT NOT NULL DEFAULT '◇',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    planned_date TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
    estimated_hours REAL NOT NULL DEFAULT 0 CHECK (estimated_hours >= 0),
    actual_hours REAL CHECK (actual_hours IS NULL OR actual_hours >= 0),
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS daily_reports (
    id TEXT PRIMARY KEY,
    report_date TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    tomorrow_plan TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_planned_date ON tasks(planned_date)',
  "CREATE INDEX IF NOT EXISTS idx_tasks_due_status ON tasks(due_date, status) WHERE status != 'done'",
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date)',
];

async function getDatabase() {
  if (!env.DB) throw new Error('云端数据库暂不可用');
  await env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql)));
  return env.DB;
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function id() {
  return crypto.randomUUID();
}

function cleanText(value: unknown, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function nullableText(value: unknown, max = 5000) {
  const cleaned = cleanText(value, max);
  return cleaned || null;
}

function hours(value: unknown, nullable = false) {
  if (nullable && (value === '' || value === null || value === undefined)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export async function GET() {
  try {
    const db = await getDatabase();
    const [projectsResult, tasksResult, reportsResult] = await db.batch([
      db.prepare('SELECT * FROM projects ORDER BY created_at DESC'),
      db.prepare('SELECT * FROM tasks ORDER BY CASE status WHEN \'in_progress\' THEN 0 WHEN \'todo\' THEN 1 ELSE 2 END, COALESCE(due_date, \'9999-12-31\'), created_at DESC'),
      db.prepare('SELECT * FROM daily_reports ORDER BY report_date DESC'),
    ]);
    return NextResponse.json({ projects: projectsResult.results, tasks: tasksResult.results, reports: reportsResult.results });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : '读取数据失败', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = await getDatabase();
    const body = await request.json() as Record<string, unknown>;
    const entity = body.entity as Entity;
    const now = new Date().toISOString();
    const recordId = id();

    if (entity === 'project') {
      const name = cleanText(body.name, 80);
      if (!name) return badRequest('请输入项目名称');
      await db.prepare(`INSERT INTO projects (id,name,description,color,icon,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(
        recordId, name, cleanText(body.description), cleanText(body.color, 20) || '#e86d4d', cleanText(body.icon, 4) || '◇', 'active', now, now,
      ).run();
    } else if (entity === 'task') {
      const title = cleanText(body.title, 160);
      if (!title) return badRequest('请输入任务名称');
      const parentId = nullableText(body.parent_id, 80);
      if (parentId) {
        const parent = await db.prepare('SELECT id,parent_id FROM tasks WHERE id=?').bind(parentId).first<{ id: string; parent_id: string | null }>();
        if (!parent || parent.parent_id) return badRequest('子任务只能隶属于父任务');
      }
      await db.prepare(`INSERT INTO tasks (id,project_id,parent_id,title,notes,planned_date,due_date,status,estimated_hours,actual_hours,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        recordId, nullableText(body.project_id, 80), parentId, title, cleanText(body.notes), nullableText(body.planned_date, 10),
        nullableText(body.due_date, 10), 'todo', hours(body.estimated_hours), null, null, now, now,
      ).run();
    } else if (entity === 'report') {
      const reportDate = cleanText(body.report_date, 10);
      const summary = cleanText(body.summary);
      if (!reportDate || !summary) return badRequest('请选择日期并填写今日总结');
      const existing = await db.prepare('SELECT * FROM daily_reports WHERE report_date=?').bind(reportDate).first();
      if (existing) return NextResponse.json({ error: '该日期已有日报', conflict: existing }, { status: 409 });
      await db.prepare(`INSERT INTO daily_reports (id,report_date,summary,tomorrow_plan,created_at,updated_at) VALUES (?,?,?,?,?,?)`).bind(
        recordId, reportDate, summary, cleanText(body.tomorrow_plan), now, now,
      ).run();
    } else return badRequest('未知的数据类型');

    return NextResponse.json({ ok: true, id: recordId });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : '保存失败', 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = await getDatabase();
    const body = await request.json() as Record<string, unknown>;
    const entity = body.entity as Entity;
    const recordId = cleanText(body.id, 80);
    const now = new Date().toISOString();
    if (!recordId) return badRequest('缺少记录编号');

    if (entity === 'project') {
      const name = cleanText(body.name, 80);
      if (!name) return badRequest('请输入项目名称');
      await db.prepare('UPDATE projects SET name=?,description=?,color=?,icon=?,status=?,updated_at=? WHERE id=?').bind(
        name, cleanText(body.description), cleanText(body.color, 20) || '#e86d4d', cleanText(body.icon, 4) || '◇',
        ['active','paused','completed'].includes(String(body.status)) ? body.status : 'active', now, recordId,
      ).run();
    } else if (entity === 'task') {
      const title = cleanText(body.title, 160);
      if (!title) return badRequest('请输入任务名称');
      const status = ['todo','in_progress','done'].includes(String(body.status)) ? String(body.status) : 'todo';
      const actualHours = hours(body.actual_hours, true);
      if (status === 'done' && actualHours === null) return badRequest('完成任务时请输入实际耗时');
      const parentId = nullableText(body.parent_id, 80);
      if (parentId) {
        if (parentId === recordId) return badRequest('任务不能隶属于自身');
        const parent = await db.prepare('SELECT id,parent_id FROM tasks WHERE id=?').bind(parentId).first<{ id: string; parent_id: string | null }>();
        if (!parent || parent.parent_id) return badRequest('子任务只能隶属于父任务');
      }
      await db.prepare(`UPDATE tasks SET project_id=?,parent_id=?,title=?,notes=?,planned_date=?,due_date=?,status=?,estimated_hours=?,actual_hours=?,completed_at=?,updated_at=? WHERE id=?`).bind(
        nullableText(body.project_id, 80), parentId, title, cleanText(body.notes), nullableText(body.planned_date, 10), nullableText(body.due_date, 10),
        status, hours(body.estimated_hours), status === 'done' ? actualHours : null, status === 'done' ? (cleanText(body.completed_at, 30) || now) : null, now, recordId,
      ).run();
    } else if (entity === 'report') {
      const reportDate = cleanText(body.report_date, 10);
      const summary = cleanText(body.summary);
      if (!reportDate || !summary) return badRequest('请选择日期并填写今日总结');
      const conflict = await db.prepare('SELECT * FROM daily_reports WHERE report_date=? AND id!=?').bind(reportDate, recordId).first();
      if (conflict) return NextResponse.json({ error: '该日期已有日报', conflict }, { status: 409 });
      await db.prepare('UPDATE daily_reports SET report_date=?,summary=?,tomorrow_plan=?,updated_at=? WHERE id=?').bind(
        reportDate, summary, cleanText(body.tomorrow_plan), now, recordId,
      ).run();
    } else return badRequest('未知的数据类型');

    return NextResponse.json({ ok: true });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : '更新失败', 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = await getDatabase();
    const entity = request.nextUrl.searchParams.get('entity') as Entity;
    const recordId = request.nextUrl.searchParams.get('id');
    if (!recordId) return badRequest('缺少记录编号');
    const table = entity === 'project' ? 'projects' : entity === 'task' ? 'tasks' : entity === 'report' ? 'daily_reports' : null;
    if (!table) return badRequest('未知的数据类型');
    await db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(recordId).run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : '删除失败', 500);
  }
}
