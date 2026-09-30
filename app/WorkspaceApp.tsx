'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Project = { id:string; name:string; description:string; color:string; icon:string; status:'active'|'paused'|'completed'; created_at:string; updated_at:string };
type Task = { id:string; project_id:string|null; parent_id:string|null; title:string; notes:string; planned_date:string|null; due_date:string|null; status:'todo'|'in_progress'|'done'; estimated_hours:number; actual_hours:number|null; completed_at:string|null; created_at:string; updated_at:string };
type Report = { id:string; report_date:string; summary:string; tomorrow_plan:string; created_at:string; updated_at:string };
type DataSet = { projects:Project[]; tasks:Task[]; reports:Report[] };
type Tab = 'today'|'tasks'|'projects'|'reports'|'stats';
type Entity = 'project'|'task'|'report';
type TodayGroup = { root:Task; items:Task[]; allChildren:Task[] };

const PROJECT_THEMES = [
  { color:'#e86d4d', icon:'◇', label:'珊瑚' }, { color:'#2f7a72', icon:'●', label:'松绿' },
  { color:'#4169a1', icon:'◆', label:'靛蓝' }, { color:'#c58b2b', icon:'✦', label:'琥珀' },
  { color:'#835b8f', icon:'✿', label:'鸢尾' }, { color:'#707770', icon:'■', label:'岩灰' },
];
const STATUS_TEXT = { todo:'待开始', in_progress:'进行中', done:'已完成' } as const;
const PROJECT_STATUS_TEXT = { active:'进行中', paused:'已暂停', completed:'已完成' } as const;

function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateKey:string, days:number) {
  const d = new Date(`${dateKey}T12:00:00`); d.setDate(d.getDate() + days); return localDate(d);
}

function formatDate(dateKey:string, full = false) {
  return new Intl.DateTimeFormat('zh-CN', full ? { year:'numeric', month:'long', day:'numeric', weekday:'short' } : { month:'short', day:'numeric' }).format(new Date(`${dateKey}T12:00:00`));
}

function projectFor(task:Task, projects:Project[]) { return projects.find((p) => p.id === task.project_id); }
function sum(values:number[]) { return values.reduce((a,b) => a + b, 0); }
function hoursLabel(value:number) { return `${Number(value.toFixed(1))}h`; }
function executableTasks(tasks:Task[]) {
  const parentIds = new Set(tasks.map((task) => task.parent_id).filter((id):id is string => !!id));
  return tasks.filter((task) => !parentIds.has(task.id));
}
function derivedStatus(children:Task[]):Task['status'] {
  if (children.length && children.every((task) => task.status === 'done')) return 'done';
  if (children.some((task) => task.status !== 'todo')) return 'in_progress';
  return 'todo';
}
function taskIsOverdue(task:Task, date:string) {
  return task.status !== 'done' && !!task.due_date && task.due_date < date;
}
function taskIsToday(task:Task, date:string) {
  return task.planned_date === date || task.due_date === date;
}
function uniqueTasks(tasks:Task[]) {
  return Array.from(new Map(tasks.map((task) => [task.id, task])).values());
}
function buildTodayGroups(tasks:Task[], date:string, mode:'today'|'overdue'):TodayGroup[] {
  const roots = tasks.filter((task) => !task.parent_id);
  return roots.flatMap((root) => {
    const children = tasks.filter((task) => task.parent_id === root.id);
    if (!children.length) {
      const matches = mode === 'today' ? taskIsToday(root, date) && !taskIsOverdue(root, date) : taskIsOverdue(root, date);
      return matches ? [{ root, items:[root], allChildren:[] }] : [];
    }
    if (mode === 'today') {
      const directlyScheduled = children.filter((task) => taskIsToday(task, date) && !taskIsOverdue(task, date));
      const unplanned = taskIsToday(root, date)
        ? children.filter((task) => task.status !== 'done' && !task.planned_date && !task.due_date)
        : [];
      const items = uniqueTasks([...directlyScheduled, ...unplanned]);
      return items.length || taskIsToday(root, date) ? [{ root, items, allChildren:children }] : [];
    }
    const overdueChildren = children.filter((task) => taskIsOverdue(task, date));
    const items = overdueChildren.length
      ? overdueChildren
      : taskIsOverdue(root, date) ? children.filter((task) => task.status !== 'done') : [];
    return items.length ? [{ root, items:uniqueTasks(items), allChildren:children }] : [];
  });
}

export default function WorkspaceApp() {
  const [data, setData] = useState<DataSet | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [modal, setModal] = useState<Record<string, unknown> | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = localDate();

  async function loadData() {
    try {
      const response = await fetch('/api/data', { cache:'no-store' });
      const payload = await response.json() as DataSet & { error?:string };
      if (!response.ok) throw new Error(payload.error || '数据读取失败');
      setData(payload); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '数据读取失败'); }
  }

  useEffect(() => { void loadData(); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer); }, [toast]);

  async function mutate(method:'POST'|'PATCH'|'DELETE', entity:Entity, body:Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const url = method === 'DELETE' ? `/api/data?entity=${entity}&id=${encodeURIComponent(String(body.id))}` : '/api/data';
      const response = await fetch(url, { method, headers: method === 'DELETE' ? undefined : { 'Content-Type':'application/json' }, body: method === 'DELETE' ? undefined : JSON.stringify({ entity, ...body }) });
      const payload = await response.json() as { error?:string; conflict?:Report };
      if (!response.ok) {
        if (response.status === 409 && payload.conflict) return { conflict:payload.conflict };
        throw new Error(payload.error || '操作失败');
      }
      await loadData();
      return { ok:true };
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : '操作失败');
      return { ok:false };
    } finally { setBusy(false); }
  }

  if (!data) return <LoadingState error={error} onRetry={loadData} />;
  const { projects, tasks, reports } = data;

  const openNewTask = (parentId?:string) => {
    const parent = tasks.find((t) => t.id === parentId);
    setModal({ type:'task', initial:{ parent_id:parentId || '', project_id:parent?.project_id || '', planned_date:today } });
  };

  async function saveProject(form:Record<string, unknown>, record?:Project) {
    const result = await mutate(record ? 'PATCH' : 'POST', 'project', record ? { ...form, id:record.id } : form);
    if (result?.ok) { setModal(null); setToast(record ? '项目已更新' : '项目已创建'); }
  }

  async function saveTask(form:Record<string, unknown>, record?:Task) {
    const result = await mutate(record ? 'PATCH' : 'POST', 'task', record ? { ...form, id:record.id } : form);
    if (result?.ok) { setModal(null); setToast(record ? '任务已更新' : '任务已创建'); }
  }

  async function completeTask(task:Task, actualHours:number) {
    const result = await mutate('PATCH', 'task', { ...task, id:task.id, status:'done', actual_hours:actualHours, completed_at:new Date().toISOString() });
    if (result?.ok) { setModal(null); setToast('任务已完成，工时已记录'); }
  }

  async function reopenTask(task:Task) {
    const result = await mutate('PATCH', 'task', { ...task, id:task.id, status:'todo', actual_hours:null, completed_at:null });
    if (result?.ok) setToast('任务已重新打开');
  }

  async function saveReport(form:Record<string, unknown>, record?:Report) {
    const result = await mutate(record ? 'PATCH' : 'POST', 'report', record ? { ...form, id:record.id } : form);
    if (result?.conflict) {
      setModal({ type:'reportConflict', draft:form, source:record || null, existing:result.conflict });
    } else if (result?.ok) { setModal(null); setToast(record ? '日报已更新' : '日报已保存'); }
  }

  async function overwriteReport(draft:Record<string, unknown>, existing:Report, source?:Report|null) {
    const result = await mutate('PATCH', 'report', { ...draft, id:existing.id });
    if (result?.ok && source && source.id !== existing.id) await mutate('DELETE', 'report', { id:source.id });
    if (result?.ok) { setModal(null); setToast('已覆盖该日期的日报'); }
  }

  async function remove(entity:Entity, id:string, label:string) {
    const result = await mutate('DELETE', entity, { id });
    if (result?.ok) { setModal(null); setToast(`${label}已删除`); }
  }

  const nav = [
    { id:'today' as Tab, icon:'⌂', label:'今日计划' }, { id:'tasks' as Tab, icon:'▦', label:'任务管理' },
    { id:'projects' as Tab, icon:'◇', label:'项目管理' }, { id:'reports' as Tab, icon:'✎', label:'每日记录' }, { id:'stats' as Tab, icon:'↗', label:'数据统计' },
  ];
  const weekStart = addDays(today, -6);
  const weekTasks = executableTasks(tasks).filter((t) => (t.completed_at?.slice(0,10) || t.planned_date || t.due_date || t.created_at.slice(0,10)) >= weekStart);
  const weekHours = sum(weekTasks.map((t) => t.actual_hours || 0));
  const weekEstimated = sum(weekTasks.map((t) => t.estimated_hours));

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setTab('today')}><span className="brand-mark">序</span><span>序作</span></button>
        <nav className="nav-list" aria-label="主导航">
          {nav.map((item) => <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><span>{item.icon}</span>{item.label}</button>)}
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">本周专注</span><strong>{hoursLabel(weekHours)}</strong>
          <div className="mini-progress"><i style={{ width:`${weekEstimated ? Math.min(100, weekHours / weekEstimated * 100) : 0}%` }} /></div>
          <small>{weekEstimated ? `已投入计划工时的 ${Math.round(weekHours / weekEstimated * 100)}%` : '从第一项任务开始记录'}</small>
        </div>
      </aside>
      <section className="workspace">
        {tab === 'today' && <TodayPage data={data} today={today} onNewTask={() => openNewTask()} onOpenTab={setTab} onShowDetails={(task) => setModal({ type:'taskDetail', task })} onComplete={(task) => setModal({ type:'complete', task })} onReopen={reopenTask} />}
        {tab === 'tasks' && <TasksPage data={data} onNewTask={openNewTask} onEdit={(task) => setModal({ type:'task', record:task })} onComplete={(task) => setModal({ type:'complete', task })} onReopen={reopenTask} onDelete={(task) => setModal({ type:'delete', entity:'task', record:task, label:'任务' })} />}
        {tab === 'projects' && <ProjectsPage data={data} onNew={() => setModal({ type:'project' })} onEdit={(project) => setModal({ type:'project', record:project })} onDelete={(project) => setModal({ type:'delete', entity:'project', record:project, label:'项目' })} />}
        {tab === 'reports' && <ReportsPage data={data} today={today} onNew={() => setModal({ type:'report' })} onEdit={(report) => setModal({ type:'report', record:report })} onDelete={(report) => setModal({ type:'delete', entity:'report', record:report, label:'日报' })} />}
        {tab === 'stats' && <StatsPage data={data} today={today} />}
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
      {modal?.type === 'project' && <ProjectModal record={modal.record as Project|undefined} busy={busy} onClose={() => setModal(null)} onSave={saveProject} />}
      {modal?.type === 'task' && <TaskModal record={modal.record as Task|undefined} initial={modal.initial as Record<string,string>|undefined} projects={projects} tasks={tasks} busy={busy} onClose={() => setModal(null)} onSave={saveTask} />}
      {modal?.type === 'taskDetail' && <TaskDetailModal task={modal.task as Task} projects={projects} tasks={tasks} onClose={() => setModal(null)} />}
      {modal?.type === 'complete' && <CompleteModal task={modal.task as Task} busy={busy} onClose={() => setModal(null)} onComplete={completeTask} />}
      {modal?.type === 'report' && <ReportModal record={modal.record as Report|undefined} today={today} tasks={tasks} projects={projects} busy={busy} onClose={() => setModal(null)} onSave={saveReport} />}
      {modal?.type === 'reportConflict' && <ConflictModal existing={modal.existing as Report} draft={modal.draft as Record<string,unknown>} source={modal.source as Report|null} busy={busy} onCancel={() => setModal(null)} onView={(record) => setModal({ type:'report', record })} onOverwrite={overwriteReport} />}
      {modal?.type === 'delete' && <DeleteModal label={String(modal.label)} record={modal.record as {id:string;name?:string;title?:string;report_date?:string}} busy={busy} onClose={() => setModal(null)} onDelete={() => remove(modal.entity as Entity, (modal.record as {id:string}).id, String(modal.label))} />}
    </main>
  );
}

function LoadingState({ error, onRetry }:{ error:string; onRetry:()=>void }) {
  return <main className="loading-page"><div className="loading-brand"><span className="brand-mark">序</span><strong>序作</strong></div>{error ? <><p>{error}</p><button className="primary-button" onClick={onRetry}>重新连接</button></> : <><span className="spinner" /><p>正在同步你的工作安排…</p></>}</main>;
}

function PageHeader({ eyebrow, title, note, action }:{ eyebrow:string; title:string; note:string; action?:React.ReactNode }) {
  return <header className="topbar"><div><p className="date-label">{eyebrow}</p><h1>{title}</h1><p className="page-note">{note}</p></div>{action}</header>;
}

function TodayPage({ data, today, onNewTask, onOpenTab, onShowDetails, onComplete, onReopen }:{ data:DataSet; today:string; onNewTask:()=>void; onOpenTab:(tab:Tab)=>void; onShowDetails:(task:Task)=>void; onComplete:(task:Task)=>void; onReopen:(task:Task)=>void }) {
  const { projects, tasks } = data;
  const todayGroups = buildTodayGroups(tasks, today, 'today');
  const overdueGroups = buildTodayGroups(tasks, today, 'overdue');
  const todayTasks = uniqueTasks(todayGroups.flatMap((group) => group.items));
  const overdueTasks = uniqueTasks(overdueGroups.flatMap((group) => group.items));
  const completed = todayTasks.filter((task) => task.status === 'done').length;
  const estimated = sum(todayTasks.map((task) => task.estimated_hours));
  const hour = new Date().getHours();
  const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const activeProjects = projects.filter((p) => p.status === 'active');
  const leafTasks = executableTasks(tasks);
  return <>
    <PageHeader eyebrow={formatDate(today, true)} title={`${greeting}，开始今天的节奏`} note="把注意力放在眼前最重要的一件事上。" action={<button className="primary-button" onClick={onNewTask}>＋ 新建任务</button>} />
    <div className="metric-grid">
      <article className="metric-card ink"><span>今日进度</span><strong>{completed} / {todayTasks.length}</strong><div className="progress-track"><i style={{ width:`${todayTasks.length ? completed / todayTasks.length * 100 : 0}%` }} /></div><small>{todayTasks.length ? `还有 ${todayTasks.length - completed} 项待推进` : '今天还没有安排任务'}</small></article>
      <article className="metric-card"><span>今日预计</span><strong>{hoursLabel(estimated)}</strong><small>仅累计可执行任务</small></article>
      <article className="metric-card"><span>逾期任务</span><strong className="warm">{overdueTasks.length}</strong><small>{overdueTasks.length ? '已单独列出，建议优先处理' : '目前没有逾期'}</small></article>
      <article className="metric-card"><span>进行中项目</span><strong>{activeProjects.length}</strong><small>{projects.length ? `共 ${projects.length} 个项目` : '创建项目集中管理'}</small></article>
    </div>
    <div className="content-grid">
      <article className="panel task-panel"><div className="panel-head"><div><span className="eyebrow">TODAY</span><h2>今日任务</h2></div><button className="text-button" onClick={() => onOpenTab('tasks')}>查看全部 →</button></div>
        {todayGroups.length || overdueGroups.length ? <div className="today-sections">
          <TodayTaskSection title="今日安排" groups={todayGroups} projects={projects} onShowDetails={onShowDetails} onComplete={onComplete} onReopen={onReopen} emptyNote="今天暂无安排，可添加一项明确的行动。" />
          {overdueGroups.length > 0 && <TodayTaskSection title="逾期未完成" groups={overdueGroups} projects={projects} onShowDetails={onShowDetails} onComplete={onComplete} onReopen={onReopen} overdue />}
        </div> : <EmptyState icon="☀" title="今天是一张空白页" note="添加任务，为今天设定一个清晰的起点。" action="添加今日任务" onAction={onNewTask} />}
      </article>
      <aside className="right-stack"><article className="panel focus-card"><div className="panel-head"><div><span className="eyebrow">PROJECTS</span><h2>项目进度</h2></div><button className="text-button" onClick={() => onOpenTab('projects')}>管理</button></div>
        {activeProjects.length ? activeProjects.slice(0,4).map((p) => { const pt = leafTasks.filter((t) => t.project_id === p.id); const rate = pt.length ? pt.filter((t) => t.status === 'done').length / pt.length * 100 : 0; return <div className="project-line" key={p.id}><span className="project-icon" style={{ color:p.color, background:`${p.color}1c` }}>{p.icon}</span><div><strong>{p.name}</strong><div className="slim-progress"><i style={{ width:`${rate}%`, background:p.color }} /></div></div><b>{Math.round(rate)}%</b></div>; }) : <EmptyState compact icon="◇" title="还没有进行中项目" note="创建项目后，进度会在这里出现。" />}
      </article><article className="quote-card"><span>“</span><p>清晰的计划不是束缚，<br />而是给重要之事留出空间。</p><small>今日提示</small></article></aside>
    </div>
  </>;
}

function TodayTaskSection({ title, groups, projects, onShowDetails, onComplete, onReopen, overdue=false, emptyNote }:{ title:string; groups:TodayGroup[]; projects:Project[]; onShowDetails:(task:Task)=>void; onComplete:(task:Task)=>void; onReopen:(task:Task)=>void; overdue?:boolean; emptyNote?:string }) {
  const count = uniqueTasks(groups.flatMap((group) => group.items)).length;
  return <section className={`today-section ${overdue ? 'overdue' : ''}`}><div className="today-section-head"><div><span className="section-mark" /><strong>{title}</strong></div><span>{count} 项</span></div>{groups.length ? <div className="today-groups">{groups.map((group) => <TodayTaskGroup key={`${title}-${group.root.id}`} group={group} projects={projects} onShowDetails={onShowDetails} onComplete={onComplete} onReopen={onReopen} overdue={overdue} />)}</div> : <p className="section-empty">{emptyNote}</p>}</section>;
}

function TodayTaskGroup({ group, projects, onShowDetails, onComplete, onReopen, overdue=false }:{ group:TodayGroup; projects:Project[]; onShowDetails:(task:Task)=>void; onComplete:(task:Task)=>void; onReopen:(task:Task)=>void; overdue?:boolean }) {
  const [showAll, setShowAll] = useState(false);
  if (!group.allChildren.length) {
    return <CompactTask task={group.root} project={projectFor(group.root, projects)} onShowDetails={onShowDetails} onToggle={() => group.root.status === 'done' ? onReopen(group.root) : onComplete(group.root)} />;
  }
  const children = group.allChildren;
  const done = children.filter((task) => task.status === 'done').length;
  const status = derivedStatus(children);
  const project = projectFor(group.root, projects);
  const visible = showAll ? group.items : group.items.slice(0, 3);
  const actual = sum(children.map((task) => task.actual_hours || 0));
  const estimated = sum(children.map((task) => task.estimated_hours));
  return <details className={`today-parent-group ${status}`} open><summary><span className="parent-chevron">›</span><span className="parent-symbol" style={{ color:project?.color || '#55736f', background:`${project?.color || '#55736f'}1c` }}>▦</span><div className="parent-copy"><button type="button" className="task-name-button parent-name-button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onShowDetails(group.root); }}>{group.root.title}</button><small><i style={{ background:project?.color || '#a9aaa5' }} />{project?.name || '未分项目'} · {done}/{children.length} 已完成 {group.root.due_date ? `· 截止 ${formatDate(group.root.due_date)}` : ''}</small></div><div className="parent-hours"><strong>{hoursLabel(actual)} / {hoursLabel(estimated)}</strong><span className={`status-badge ${status}`}>{STATUS_TEXT[status]}</span></div></summary><div className="today-child-list">{visible.length ? visible.map((task) => <CompactTask key={task.id} task={task} project={projectFor(task, projects)} nested onShowDetails={onShowDetails} onToggle={() => task.status === 'done' ? onReopen(task) : onComplete(task)} />) : <p className="group-empty">父任务属于今天，但暂时没有需要今天执行的子任务。</p>}{group.items.length > 3 && <button className="show-more" onClick={() => setShowAll((value) => !value)}>{showAll ? '收起部分子任务' : `显示其余 ${group.items.length - 3} 项`}</button>}{overdue && group.items.length > 0 && <small className="overdue-tip">先完成最早到期的子任务，父任务进度会自动更新。</small>}</div></details>;
}

function CompactTask({ task, project, onShowDetails, onToggle, nested=false }:{ task:Task; project?:Project; onShowDetails:(task:Task)=>void; onToggle:()=>void; nested?:boolean }) {
  const today = localDate(); const overdue = task.status !== 'done' && !!task.due_date && task.due_date < today;
  return <div className={`task-row ${nested ? 'nested' : ''} ${task.status === 'done' ? 'done' : ''}`}><button className="check" onClick={onToggle} aria-label={task.status === 'done' ? '重新打开任务' : '完成任务'}>{task.status === 'done' ? '✓' : ''}</button><div><button type="button" className="task-name-button" onClick={() => onShowDetails(task)}>{task.title}</button><small><i style={{ background:project?.color || '#a9aaa5' }} />{project?.name || '未分项目'} {overdue ? <em>· 已逾期</em> : ''}</small></div><span className="time-pill">{task.status === 'done' ? `实际 ${hoursLabel(task.actual_hours || 0)}` : `预计 ${hoursLabel(task.estimated_hours)}`}</span><span className={`status-dot ${task.status}`}>{STATUS_TEXT[task.status]}</span></div>;
}

function TasksPage({ data, onNewTask, onEdit, onComplete, onReopen, onDelete }:{ data:DataSet; onNewTask:(parentId?:string)=>void; onEdit:(task:Task)=>void; onComplete:(task:Task)=>void; onReopen:(task:Task)=>void; onDelete:(task:Task)=>void }) {
  const [query, setQuery] = useState(''); const [projectId, setProjectId] = useState(''); const [status, setStatus] = useState('');
  const matches = (task:Task, statusOverride?:Task['status']) => (!query || task.title.toLowerCase().includes(query.toLowerCase())) && (!projectId || task.project_id === projectId) && (!status || (statusOverride || task.status) === status);
  const roots = data.tasks.filter((task) => !task.parent_id);
  const parentTasks = roots.filter((root) => { const children=data.tasks.filter((task)=>task.parent_id===root.id); return matches(root,children.length?derivedStatus(children):root.status)||children.some((child)=>matches(child)); });
  return <><PageHeader eyebrow="TASKS" title="任务管理" note="父任务建立方向，子任务拆解行动；也可以只保留一个父任务。" action={<button className="primary-button" onClick={() => onNewTask()}>＋ 新建任务</button>} />
    <div className="filter-bar"><label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索任务" /></label><select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">全部项目</option>{data.projects.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="todo">待开始</option><option value="in_progress">进行中</option><option value="done">已完成</option></select></div>
    <article className="panel table-panel">{parentTasks.length ? parentTasks.map((task) => { const allChildren=data.tasks.filter((child)=>child.parent_id===task.id); const rootMatches=matches(task,allChildren.length?derivedStatus(allChildren):task.status); const visibleChildren=rootMatches?allChildren:allChildren.filter((child)=>matches(child)); return <TaskGroup key={task.id} task={task} children={visibleChildren} allChildren={allChildren} projects={data.projects} onNewTask={onNewTask} onEdit={onEdit} onComplete={onComplete} onReopen={onReopen} onDelete={onDelete} />; }) : <EmptyState icon="▦" title="没有匹配的任务" note={data.tasks.length ? '尝试调整筛选条件。' : '新建第一个父任务，需要时再继续拆分子任务。'} action={data.tasks.length ? undefined : '新建任务'} onAction={data.tasks.length ? undefined : () => onNewTask()} />}</article>
  </>;
}

function TaskGroup({ task, children, allChildren, projects, onNewTask, onEdit, onComplete, onReopen, onDelete }:{ task:Task; children:Task[]; allChildren:Task[]; projects:Project[]; onNewTask:(id?:string)=>void; onEdit:(t:Task)=>void; onComplete:(t:Task)=>void; onReopen:(t:Task)=>void; onDelete:(t:Task)=>void }) {
  const container = allChildren.length ? { done:allChildren.filter((child) => child.status === 'done').length, total:allChildren.length, status:derivedStatus(allChildren), estimated:sum(allChildren.map((child) => child.estimated_hours)), actual:sum(allChildren.map((child) => child.actual_hours || 0)) } : undefined;
  return <div className="task-group"><TaskDetailRow task={task} project={projectFor(task,projects)} container={container} onEdit={onEdit} onComplete={onComplete} onReopen={onReopen} onDelete={onDelete} /><div className="child-list">{children.map((child) => <TaskDetailRow key={child.id} task={child} project={projectFor(child,projects)} child onEdit={onEdit} onComplete={onComplete} onReopen={onReopen} onDelete={onDelete} />)}<button className="add-child" onClick={() => onNewTask(task.id)}>＋ 添加子任务</button></div></div>;
}

function TaskDetailRow({ task, project, child, container, onEdit, onComplete, onReopen, onDelete }:{ task:Task; project?:Project; child?:boolean; container?:{done:number;total:number;status:Task['status'];estimated:number;actual:number}; onEdit:(t:Task)=>void; onComplete:(t:Task)=>void; onReopen:(t:Task)=>void; onDelete:(t:Task)=>void }) {
  const displayStatus = container?.status || task.status;
  const displayEstimated = container?.estimated ?? task.estimated_hours;
  const displayActual = container?.actual ?? task.actual_hours;
  return <div className={`detail-task ${child ? 'child' : ''} ${container ? 'container' : ''} ${displayStatus === 'done' ? 'done' : ''}`}>{container ? <span className="group-count" title="父任务进度">{container.done}/{container.total}</span> : <button className="check" onClick={() => task.status === 'done' ? onReopen(task) : onComplete(task)}>{task.status === 'done' ? '✓' : ''}</button>}<div className="detail-main"><div className="task-title-line">{child && <span className="branch">↳</span>}<strong>{task.title}</strong>{container && <span className="container-label">父任务</span>}<span className={`status-badge ${displayStatus}`}>{STATUS_TEXT[displayStatus]}</span></div><div className="task-meta"><span><i style={{ background:project?.color || '#aaa' }} />{project?.name || '未分项目'}</span>{task.planned_date && <span>安排 {formatDate(task.planned_date)}</span>}{task.due_date && <span>截止 {formatDate(task.due_date)}</span>}<span>{container ? '子任务预计' : '预计'} {hoursLabel(displayEstimated)}</span>{displayActual !== null && <span>{container ? '子任务实际' : '实际'} {hoursLabel(displayActual)}</span>}</div></div><div className="row-actions"><button onClick={() => onEdit(task)}>编辑</button><button className="danger-text" onClick={() => onDelete(task)}>删除</button></div></div>;
}

function ProjectsPage({ data, onNew, onEdit, onDelete }:{ data:DataSet; onNew:()=>void; onEdit:(p:Project)=>void; onDelete:(p:Project)=>void }) {
  const leafTasks = executableTasks(data.tasks);
  return <><PageHeader eyebrow="PROJECTS" title="项目管理" note="查看每个项目的任务进度与累计实际耗时。" action={<button className="primary-button" onClick={onNew}>＋ 新建项目</button>} />
    {data.projects.length ? <div className="project-grid">{data.projects.map((project) => { const pt = leafTasks.filter((t) => t.project_id === project.id); const done = pt.filter((t) => t.status === 'done'); const rate = pt.length ? done.length / pt.length * 100 : 0; const actual = sum(done.map((t) => t.actual_hours || 0)); const estimate = sum(pt.map((t) => t.estimated_hours)); return <article className="project-card" key={project.id} style={{ '--project':project.color } as React.CSSProperties}><div className="project-card-top"><span className="large-project-icon" style={{ color:project.color, background:`${project.color}1c` }}>{project.icon}</span><span className={`project-status ${project.status}`}>{PROJECT_STATUS_TEXT[project.status]}</span></div><h2>{project.name}</h2><p>{project.description || '这个项目还没有描述。'}</p><div className="project-stat-line"><span>{done.length} / {pt.length} 项可执行任务完成</span><b>{Math.round(rate)}%</b></div><div className="project-progress"><i style={{ width:`${rate}%` }} /></div><div className="hours-grid"><div><small>累计实际耗时</small><strong>{hoursLabel(actual)}</strong></div><div><small>预计总耗时</small><strong>{hoursLabel(estimate)}</strong></div></div><div className="card-actions"><button onClick={() => onEdit(project)}>编辑项目</button><button className="danger-text" onClick={() => onDelete(project)}>删除</button></div></article>; })}</div> : <article className="panel"><EmptyState icon="◇" title="从一个项目开始" note="用颜色和图标区分不同主题，再把任务归入项目。" action="新建项目" onAction={onNew} /></article>}
  </>;
}

function ReportsPage({ data, today, onNew, onEdit, onDelete }:{ data:DataSet; today:string; onNew:()=>void; onEdit:(r:Report)=>void; onDelete:(r:Report)=>void }) {
  const leafTasks = executableTasks(data.tasks);
  return <><PageHeader eyebrow="DAILY NOTES" title="每日记录" note="在一天结束时回望进度，也为明天留下一条清晰线索。" action={<button className="primary-button" onClick={onNew}>✎ 写日报</button>} />
    {data.reports.length ? <div className="report-list">{data.reports.map((report) => { const dayTasks = leafTasks.filter((t) => t.planned_date === report.report_date || (t.status !== 'done' && !!t.due_date && t.due_date < report.report_date)); const completed = dayTasks.filter((t) => t.status === 'done').length; return <article className="report-card" key={report.id}><div className="report-date"><strong>{new Date(`${report.report_date}T12:00:00`).getDate()}</strong><span>{new Intl.DateTimeFormat('zh-CN',{month:'short'}).format(new Date(`${report.report_date}T12:00:00`))}</span></div><div className="report-content"><div className="report-head"><div><h2>{report.report_date === today ? '今日记录' : formatDate(report.report_date, true)}</h2><span>{dayTasks.length ? `关联任务完成 ${completed}/${dayTasks.length}` : '当日没有关联任务'}</span></div><div className="row-actions"><button onClick={() => onEdit(report)}>编辑</button><button className="danger-text" onClick={() => onDelete(report)}>删除</button></div></div><p>{report.summary}</p>{report.tomorrow_plan && <div className="tomorrow-note"><strong>明日计划</strong><span>{report.tomorrow_plan}</span></div>}</div></article>; })}</div> : <article className="panel"><EmptyState icon="✎" title="还没有日报" note="写下今天推进了什么、遇到了什么，以及下一步。" action="写第一篇日报" onAction={onNew} /></article>}
  </>;
}

function StatsPage({ data, today }:{ data:DataSet; today:string }) {
  const leafTasks = executableTasks(data.tasks);
  const [period, setPeriod] = useState('30'); const [projectId, setProjectId] = useState(''); const [customStart, setCustomStart] = useState(addDays(today,-29)); const [customEnd, setCustomEnd] = useState(today);
  const dateRange = useMemo(() => { if (period === 'all') { const dates = executableTasks(data.tasks).map((t) => t.created_at.slice(0,10)).sort(); return { start:dates[0] || addDays(today,-29), end:today }; } if (period === 'custom') return { start:customStart, end:customEnd }; return { start:addDays(today, -(Number(period)-1)), end:today }; }, [period, customStart, customEnd, data.tasks, today]);
  const taskDate = (t:Task) => t.completed_at?.slice(0,10) || t.planned_date || t.due_date || t.created_at.slice(0,10);
  const filtered = leafTasks.filter((t) => (!projectId || t.project_id === projectId) && taskDate(t) >= dateRange.start && taskDate(t) <= dateRange.end);
  const done = filtered.filter((t) => t.status === 'done'); const actual = sum(done.map((t) => t.actual_hours || 0)); const estimated = sum(filtered.map((t) => t.estimated_hours)); const completion = filtered.length ? done.length / filtered.length * 100 : 0;
  const statusCounts = { done:done.length, doing:filtered.filter((t) => t.status === 'in_progress').length, todo:filtered.filter((t) => t.status === 'todo').length };
  const totalForDonut = filtered.length || 1; const doneDeg = statusCounts.done / totalForDonut * 360; const doingDeg = doneDeg + statusCounts.doing / totalForDonut * 360;
  const startMs = new Date(`${dateRange.start}T12:00:00`).getTime(); const endMs = new Date(`${dateRange.end}T12:00:00`).getTime(); const span = Math.max(1,endMs-startMs); const buckets = Array.from({length:7},(_,i) => ({ label:formatDate(localDate(new Date(startMs + span * i / 6))), count:0, hours:0 }));
  filtered.forEach((task) => { const ratio = (new Date(`${taskDate(task)}T12:00:00`).getTime()-startMs)/span; const index = Math.max(0,Math.min(6,Math.round(ratio*6))); buckets[index].count += task.status === 'done' ? 1 : 0; buckets[index].hours += task.actual_hours || 0; });
  const maxBar = Math.max(1,...buckets.map((b) => b.hours));
  const projectHours = data.projects.map((p) => ({ project:p, hours:sum(filtered.filter((t) => t.project_id === p.id).map((t) => t.actual_hours || 0)) })).filter((x) => x.hours > 0).sort((a,b) => b.hours-a.hours);
  const maxProjectHours = Math.max(1,...projectHours.map((p) => p.hours));
  return <><PageHeader eyebrow="INSIGHTS" title="数据统计" note="按时间与项目筛选，观察完成情况和真实时间投入。" />
    <div className="filter-bar stats-filter"><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="all">全部时间</option><option value="custom">自定义</option></select><select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">全部项目</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{period === 'custom' && <><input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} /><span>至</span><input type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)} /></>}</div>
    <div className="stats-metrics"><article><span>可执行任务</span><strong>{filtered.length}</strong><small>父任务不重复计数</small></article><article><span>完成率</span><strong>{Math.round(completion)}%</strong><small>{done.length} 项已完成</small></article><article><span>实际耗时</span><strong>{hoursLabel(actual)}</strong><small>可执行任务合计</small></article><article><span>预计耗时</span><strong>{hoursLabel(estimated)}</strong><small>{estimated ? `实际 / 预计 ${Math.round(actual/estimated*100)}%` : '暂无预计工时'}</small></article></div>
    <div className="charts-grid"><article className="panel chart-card wide"><div className="panel-head"><div><span className="eyebrow">TIME</span><h2>实际工时趋势</h2></div><span className="chart-total">共 {hoursLabel(actual)}</span></div><div className="bar-chart">{buckets.map((bucket,i) => <div className="bar-column" key={i}><div className="bar-value">{bucket.hours ? Number(bucket.hours.toFixed(1)) : ''}</div><div className="bar-track"><i style={{ height:`${Math.max(bucket.hours ? 8 : 0,bucket.hours/maxBar*100)}%` }} /></div><small>{bucket.label}</small></div>)}</div></article>
      <article className="panel chart-card"><div className="panel-head"><div><span className="eyebrow">STATUS</span><h2>任务状态</h2></div></div><div className="donut-wrap"><div className="donut" style={{ background:`conic-gradient(#2f7a72 0 ${doneDeg}deg,#e7a85c ${doneDeg}deg ${doingDeg}deg,#d9d6cf ${doingDeg}deg 360deg)` }}><div><strong>{filtered.length}</strong><span>项任务</span></div></div><div className="legend"><span><i className="green" />已完成 <b>{statusCounts.done}</b></span><span><i className="gold" />进行中 <b>{statusCounts.doing}</b></span><span><i className="gray" />待开始 <b>{statusCounts.todo}</b></span></div></div></article>
      <article className="panel chart-card wide"><div className="panel-head"><div><span className="eyebrow">PROJECTS</span><h2>项目工时分布</h2></div></div>{projectHours.length ? <div className="horizontal-bars">{projectHours.map(({project,hours}) => <div className="hbar-row" key={project.id}><span className="project-icon small" style={{ color:project.color,background:`${project.color}1c` }}>{project.icon}</span><strong>{project.name}</strong><div><i style={{ width:`${hours/maxProjectHours*100}%`,background:project.color }} /></div><b>{hoursLabel(hours)}</b></div>)}</div> : <EmptyState compact icon="↗" title="暂无实际工时" note="完成任务并记录实际耗时后，这里会显示项目分布。" />}</article>
    </div>
  </>;
}

function EmptyState({ icon, title, note, action, onAction, compact=false }:{ icon:string; title:string; note:string; action?:string; onAction?:()=>void; compact?:boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><span>{icon}</span><strong>{title}</strong><p>{note}</p>{action && <button className="secondary-button" onClick={onAction}>{action}</button>}</div>;
}

function ModalFrame({ title, note, onClose, children, wide=false }:{ title:string; note?:string; onClose:()=>void; children:React.ReactNode; wide?:boolean }) {
  useEffect(() => { const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();}; window.addEventListener('keydown',handler); return()=>window.removeEventListener('keydown',handler); },[onClose]);
  return <div className="modal-backdrop" onMouseDown={(e) => { if(e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2>{note && <p>{note}</p>}</div><button onClick={onClose} aria-label="关闭">×</button></div>{children}</section></div>;
}

function TaskDetailModal({ task, projects, tasks, onClose }:{ task:Task; projects:Project[]; tasks:Task[]; onClose:()=>void }) {
  const project = projectFor(task, projects);
  const parent = task.parent_id ? tasks.find((item) => item.id === task.parent_id) : undefined;
  const children = tasks.filter((item) => item.parent_id === task.id);
  const displayStatus = children.length ? derivedStatus(children) : task.status;
  const estimated = children.length ? sum(children.map((item) => item.estimated_hours)) : task.estimated_hours;
  const actual = children.length ? sum(children.map((item) => item.actual_hours || 0)) : task.actual_hours;
  const level = children.length ? '父任务' : parent ? '子任务' : '独立任务';
  const completedChildren = children.filter((item) => item.status === 'done').length;
  return <ModalFrame title={task.title} note={`${level}详情 · 仅供查看，不会修改任务数据`} onClose={onClose}><div className="task-detail-content"><div className="task-detail-badges"><span className={`status-badge ${displayStatus}`}>{STATUS_TEXT[displayStatus]}</span><span>{level}</span></div><section className="task-note-box"><span>任务备注</span><p className={task.notes ? '' : 'empty'}>{task.notes || '该任务暂未填写备注。'}</p></section><div className="task-detail-grid"><div><span>所属项目</span><strong><i style={{ color:project?.color || '#7d8581', background:`${project?.color || '#7d8581'}1c` }}>{project?.icon || '◇'}</i>{project?.name || '未分项目'}</strong></div>{parent && <div><span>父任务</span><strong>{parent.title}</strong></div>}<div><span>安排日期</span><strong>{task.planned_date ? formatDate(task.planned_date, true) : '未设置'}</strong></div><div><span>截止日期</span><strong>{task.due_date ? formatDate(task.due_date, true) : '未设置'}</strong></div><div><span>{children.length ? '子任务预计耗时' : '预计耗时'}</span><strong>{hoursLabel(estimated)}</strong></div><div><span>{children.length ? '子任务实际耗时' : '实际耗时'}</span><strong>{actual === null ? '尚未记录' : hoursLabel(actual)}</strong></div>{children.length > 0 && <div><span>子任务进度</span><strong>{completedChildren} / {children.length} 已完成</strong></div>}</div><div className="modal-actions"><button type="button" className="primary-button" onClick={onClose}>知道了</button></div></div></ModalFrame>;
}

function ProjectModal({ record, busy, onClose, onSave }:{ record?:Project; busy:boolean; onClose:()=>void; onSave:(form:Record<string,unknown>,record?:Project)=>void }) {
  const initialTheme = PROJECT_THEMES.find((t) => t.color === record?.color) || PROJECT_THEMES[0];
  const [name,setName]=useState(record?.name||''); const [description,setDescription]=useState(record?.description||''); const [theme,setTheme]=useState(initialTheme); const [status,setStatus]=useState(record?.status||'active');
  function submit(e:FormEvent){e.preventDefault(); void onSave({name,description,color:theme.color,icon:theme.icon,status},record);}
  return <ModalFrame title={record ? '编辑项目' : '新建项目'} note="用一个直观的主题图标快速识别项目。" onClose={onClose}><form onSubmit={submit} className="form-stack"><label>项目名称<input required autoFocus maxLength={80} value={name} onChange={(e)=>setName(e.target.value)} placeholder="例如：官网改版" /></label><label>项目描述<textarea rows={3} value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="写下项目目标或范围" /></label><fieldset><legend>主题色与图标</legend><div className="theme-picker">{PROJECT_THEMES.map((item)=><button type="button" key={item.color} className={theme.color===item.color?'selected':''} onClick={()=>setTheme(item)} aria-label={item.label}><span style={{background:`${item.color}1c`,color:item.color}}>{item.icon}</span><small>{item.label}</small></button>)}</div></fieldset>{record&&<label>项目状态<select value={status} onChange={(e)=>setStatus(e.target.value as Project['status'])}><option value="active">进行中</option><option value="paused">已暂停</option><option value="completed">已完成</option></select></label>}<div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy?'保存中…':record?'保存修改':'创建项目'}</button></div></form></ModalFrame>;
}

function TaskModal({ record, initial, projects, tasks, busy, onClose, onSave }:{ record?:Task; initial?:Record<string,string>; projects:Project[]; tasks:Task[]; busy:boolean; onClose:()=>void; onSave:(form:Record<string,unknown>,record?:Task)=>void }) {
  const [title,setTitle]=useState(record?.title||''); const [notes,setNotes]=useState(record?.notes||''); const [projectId,setProjectId]=useState(record?.project_id||initial?.project_id||''); const [parentId,setParentId]=useState(record?.parent_id||initial?.parent_id||''); const [plannedDate,setPlannedDate]=useState(record?.planned_date||initial?.planned_date||localDate()); const [dueDate,setDueDate]=useState(record?.due_date||''); const [estimated,setEstimated]=useState(String(record?.estimated_hours??'')); const [status,setStatus]=useState(record?.status||'todo'); const [actual,setActual]=useState(String(record?.actual_hours??''));
  const parents=tasks.filter((t)=>!t.parent_id&&t.id!==record?.id);
  const hasChildren=!!record&&tasks.some((task)=>task.parent_id===record.id);
  function submit(e:FormEvent){e.preventDefault(); void onSave({title,notes,project_id:projectId,parent_id:parentId,planned_date:plannedDate,due_date:dueDate,estimated_hours:Number(estimated),status,actual_hours:status==='done'?Number(actual):null,completed_at:record?.completed_at},record);}
  return <ModalFrame wide title={record?'编辑任务':parentId?'新建子任务':'新建任务'} note={hasChildren?'此父任务的状态与工时由子任务自动汇总，现有记录不会被改写。':'任务最多分为父任务与子任务两个层级。'} onClose={onClose}><form onSubmit={submit} className="form-stack"><label>任务名称<input required autoFocus maxLength={160} value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="明确写下要完成的事项" /></label><div className="form-grid"><label>所属项目<select value={projectId} onChange={(e)=>setProjectId(e.target.value)}><option value="">未分项目</option>{projects.map((p)=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>父任务（可选）<select value={parentId} onChange={(e)=>setParentId(e.target.value)} disabled={hasChildren}><option value="">作为父任务</option>{parents.map((t)=><option value={t.id} key={t.id}>{t.title}</option>)}</select>{hasChildren&&<small className="field-hint">已有子任务的父任务不能再改为子任务。</small>}</label><label>安排日期<input type="date" value={plannedDate} onChange={(e)=>setPlannedDate(e.target.value)} /></label><label>截止日期<input type="date" value={dueDate} min={plannedDate||undefined} onChange={(e)=>setDueDate(e.target.value)} /></label><label>{hasChildren?'父任务目标耗时（仅作参考）':'预计耗时（小时）'}<input required type="number" min="0" step="0.1" value={estimated} onChange={(e)=>setEstimated(e.target.value)} placeholder="例如 1.5" />{hasChildren&&<small className="field-hint">统计中只累计子任务，避免重复计算。</small>}</label>{record&&!hasChildren&&<label>任务状态<select value={status} onChange={(e)=>setStatus(e.target.value as Task['status'])}><option value="todo">待开始</option><option value="in_progress">进行中</option>{record.status==='done'&&<option value="done">已完成</option>}</select></label>}{record&&!hasChildren&&status==='done'&&<label>实际耗时（小时）<input required type="number" min="0" step="0.1" value={actual} onChange={(e)=>setActual(e.target.value)} /></label>}</div><label>备注<textarea rows={3} value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="补充背景、交付标准或相关线索" /></label><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy?'保存中…':record?'保存修改':'创建任务'}</button></div></form></ModalFrame>;
}

function CompleteModal({ task, busy, onClose, onComplete }:{ task:Task; busy:boolean; onClose:()=>void; onComplete:(task:Task,hours:number)=>void }) {
  const [actual,setActual]=useState(String(task.actual_hours??task.estimated_hours));
  return <ModalFrame title="完成任务" note="记录实际投入，项目总耗时会自动更新。" onClose={onClose}><form className="form-stack" onSubmit={(e)=>{e.preventDefault();void onComplete(task,Number(actual));}}><div className="completion-task"><span>✓</span><div><small>即将完成</small><strong>{task.title}</strong></div></div><label>实际耗时（小时）<input autoFocus required type="number" min="0" step="0.1" value={actual} onChange={(e)=>setActual(e.target.value)} /><small className="field-hint">预计耗时为 {hoursLabel(task.estimated_hours)}，可输入小数。</small></label><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>暂不完成</button><button className="primary-button" disabled={busy}>{busy?'记录中…':'确认完成'}</button></div></form></ModalFrame>;
}

function ReportModal({ record, today, tasks, projects, busy, onClose, onSave }:{ record?:Report; today:string; tasks:Task[]; projects:Project[]; busy:boolean; onClose:()=>void; onSave:(form:Record<string,unknown>,record?:Report)=>void }) {
  const [date,setDate]=useState(record?.report_date||today); const [summary,setSummary]=useState(record?.summary||''); const [tomorrow,setTomorrow]=useState(record?.tomorrow_plan||'');
  const related=executableTasks(tasks).filter((t)=>t.planned_date===date||(t.status!=='done'&&!!t.due_date&&t.due_date<date));
  return <ModalFrame wide title={record?'编辑日报':'写日报'} note="日期默认为今天，也可以补写或回顾其他日期。" onClose={onClose}><form onSubmit={(e)=>{e.preventDefault();void onSave({report_date:date,summary,tomorrow_plan:tomorrow},record);}} className="form-stack"><label>记录日期<input required type="date" value={date} onChange={(e)=>setDate(e.target.value)} /></label><label>今日总结<textarea autoFocus required rows={6} value={summary} onChange={(e)=>setSummary(e.target.value)} placeholder="今天完成了什么？有哪些进展、问题或收获？" /></label><div className="related-tasks"><div className="related-head"><strong>当日任务与逾期未完成任务</strong><span>{related.length} 项</span></div>{related.length?<div>{related.map((task)=><div className="related-task" key={task.id}><span className="project-mini" style={{color:projectFor(task,projects)?.color}}>{projectFor(task,projects)?.icon||'·'}</span><strong>{task.title}</strong>{task.due_date&&task.due_date<date&&task.status!=='done'&&<em>逾期</em>}<span className={`status-badge ${task.status}`}>{STATUS_TEXT[task.status]}</span></div>)}</div>:<p>该日期没有安排任务，也没有逾期事项。</p>}</div><label>明日计划（可选）<textarea rows={3} value={tomorrow} onChange={(e)=>setTomorrow(e.target.value)} placeholder="明天最重要的一件事是什么？" /></label><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy?'保存中…':'保存日报'}</button></div></form></ModalFrame>;
}

function ConflictModal({ existing, draft, source, busy, onCancel, onView, onOverwrite }:{ existing:Report; draft:Record<string,unknown>; source:Report|null; busy:boolean; onCancel:()=>void; onView:(r:Report)=>void; onOverwrite:(draft:Record<string,unknown>,existing:Report,source:Report|null)=>void }) {
  return <ModalFrame title="该日期已有日报" note={`${formatDate(existing.report_date,true)} 已存在一条记录，请选择后续操作。`} onClose={onCancel}><div className="conflict-preview"><span>已有内容</span><p>{existing.summary}</p></div><div className="conflict-actions"><button className="ghost-button" onClick={onCancel}>取消</button><button className="secondary-button" onClick={()=>onView(existing)}>查看并编辑原日报</button><button className="danger-button" disabled={busy} onClick={()=>void onOverwrite(draft,existing,source)}>{busy?'处理中…':'覆盖原日报'}</button></div></ModalFrame>;
}

function DeleteModal({ label, record, busy, onClose, onDelete }:{ label:string; record:{name?:string;title?:string;report_date?:string}; busy:boolean; onClose:()=>void; onDelete:()=>void }) {
  const name=record.name||record.title||record.report_date||label;
  return <ModalFrame title={`删除${label}`} note="此操作无法撤销。" onClose={onClose}><div className="delete-copy"><span>!</span><p>确定要删除“<strong>{name}</strong>”吗？{label==='项目'&&' 项目中的任务会保留，但会变为未分项目。'}{label==='任务'&&' 若这是父任务，其子任务也会一并删除。'}</p></div><div className="modal-actions"><button className="ghost-button" onClick={onClose}>取消</button><button className="danger-button" disabled={busy} onClick={onDelete}>{busy?'删除中…':'确认删除'}</button></div></ModalFrame>;
}
