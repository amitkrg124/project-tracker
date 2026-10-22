// Team Tracker front end: plain JavaScript, no build step.
'use strict';

const LABELS = {
  priority: { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' },
  task: { todo: '⏳ To Do', doing: '🔄 Doing', done: '✅ Done', postponed: '⏸ Later' },
  project: { planning: '📝 Planning', active: '🚀 Active', hold: '⏸ On Hold', done: '✅ Done' },
  work: { todo: '⏳ To Do', doing: '🔄 Doing', blocked: '🚧 Blocked', done: '✅ Done' },
  update: { progress: '✅ Progress', issue: '⚠️ Issue', decision: '💡 Decision' },
};
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const NEXT_STATUS = { todo: 'doing', doing: 'done', done: 'todo', postponed: 'todo', blocked: 'doing' };
const SYNC_EVERY_MS = 15000;

const state = {
  config: null,
  me: localStorage.getItem('tt-me') || '',
  passcode: localStorage.getItem('tt-passcode') || '',
  view: 'today',
  date: todayISO(),
  who: localStorage.getItem('tt-who') || 'all',
  sort: localStorage.getItem('tt-sort') || 'time',
  pfilter: 'open',
  projectId: null,
  projects: [],
  tasks: [],
  overdue: [],
};

const $ = sel => document.querySelector(sel);

// ---------- Helpers ----------
function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toISO(d);
}
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
  return iso ? parseISO(iso).toLocaleDateString(undefined, opts) : '';
}
function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function timeAgo(ts) {
  const mins = Math.round((Date.now() - new Date(ts)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function slotOf(time) {
  if (!time) return { key: 'any', label: '🕘 Anytime' };
  const h = Number(time.slice(0, 2));
  if (h < 12) return { key: 'morning', label: '🌅 Morning' };
  if (h < 17) return { key: 'afternoon', label: '☀️ Afternoon' };
  return { key: 'evening', label: '🌙 Evening' };
}
function byTime(a, b) {
  if (a.time !== b.time) return !a.time ? 1 : !b.time ? -1 : a.time.localeCompare(b.time);
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}
function byPriority(a, b) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byTime(a, b);
}
function isMine(assignee) {
  return state.who === 'all' || assignee === state.who || assignee === 'Both';
}
function people() {
  return [...state.config.members, 'Both'];
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------- API ----------
async function api(method, url, body) {
  const sync = $('#sync');
  sync.className = 'sync busy';
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-passcode': state.passcode, 'x-member': state.me },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { signOut(); throw new Error('Please sign in again'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    sync.className = 'sync';
    sync.title = `Synced ${new Date().toLocaleTimeString()}`;
    return data;
  } catch (err) {
    sync.className = 'sync off';
    sync.title = 'Offline - changes not saved';
    throw err;
  }
}

function replaceProject(p) {
  const i = state.projects.findIndex(x => x._id === p._id);
  if (i >= 0) state.projects[i] = p; else state.projects.unshift(p);
}

async function refresh() {
  const [projects, taskData] = await Promise.all([
    api('GET', '/api/projects'),
    api('GET', `/api/tasks?date=${state.date}&today=${todayISO()}`),
  ]);
  state.projects = projects;
  state.tasks = taskData.tasks;
  state.overdue = taskData.overdue;
  render();
}
const safeRefresh = () => refresh().catch(err => toast(err.message));

// ---------- Sign in ----------
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#passcode').hidden = !state.config.needsPasscode;
  $('#member-buttons').innerHTML = state.config.members
    .map(m => `<button data-member="${esc(m)}">👤 ${esc(m)}</button>`).join('');
}

async function signIn(member) {
  const passcode = $('#passcode').value;
  const err = $('#login-error');
  err.hidden = true;
  try {
    if (state.config.needsPasscode) {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) });
      if (!res.ok) throw new Error('Wrong passcode');
    }
    state.me = member;
    state.passcode = passcode;
    localStorage.setItem('tt-me', member);
    localStorage.setItem('tt-passcode', passcode);
    startApp();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

function signOut() {
  localStorage.removeItem('tt-me');
  localStorage.removeItem('tt-passcode');
  state.me = '';
  state.passcode = '';
  showLogin();
}

function startApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#me-btn').textContent = state.me.trim().charAt(0).toUpperCase();
  $('#me-btn').title = `Signed in as ${state.me} - tap to switch`;
  safeRefresh();
}

// ---------- Render ----------
function render() {
  $('#view-today').hidden = state.view !== 'today';
  $('#view-projects').hidden = state.view !== 'projects';
  $('#view-project').hidden = state.view !== 'project';
  $('#back-btn').hidden = state.view !== 'project';
  document.querySelectorAll('.tabbar button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === state.view || (state.view === 'project' && b.dataset.tab === 'projects')));

  if (state.view === 'today') renderToday();
  else if (state.view === 'projects') renderProjects();
  else renderProject();
}

function taskCard(t, { overdue = false } = {}) {
  const done = t.status === 'done';
  const meta = [
    overdue ? `<span class="error">⚠️ ${esc(fmtDate(t.date))}</span>` : '',
    t.time ? `<span>⏰ ${esc(fmtTime(t.time))}</span>` : '',
    t.assignee ? `<span>👤 ${esc(t.assignee)}</span>` : '',
    t.project ? `<span>📁 ${esc(t.project.name)}</span>` : '',
  ].join('');
  return `
    <div class="task ${t.priority} ${done ? 'is-done' : ''}">
      <button class="check ${done ? 'on' : ''}" data-action="toggle-task" data-id="${t._id}" aria-label="Mark done">${done ? '✓' : ''}</button>
      <div class="task-main" data-action="edit-task" data-id="${t._id}">
        <div class="task-title">${esc(t.title)}</div>
        <div class="meta">${meta}</div>
      </div>
      <div class="task-side">
        ${overdue
          ? `<button class="small-btn" data-action="move-today" data-id="${t._id}">→ Today</button>`
          : `<button class="pill ${t.status}" data-action="cycle-task" data-id="${t._id}">${LABELS.task[t.status]}</button>`}
      </div>
    </div>`;
}

function renderToday() {
  const today = todayISO();
  const rel = { [today]: 'Today', [todayISO(1)]: 'Tomorrow', [todayISO(-1)]: 'Yesterday' }[state.date];
  const long = fmtDate(state.date, { weekday: 'short', month: 'short', day: 'numeric' });
  $('#view-title').textContent = rel || long;
  $('#date-label').textContent = rel ? `${rel} · ${long}` : `📅 ${long}`;

  $('#who-filter').innerHTML = ['all', ...state.config.members].map(m =>
    `<button class="chip ${state.who === m ? 'active' : ''}" data-who="${esc(m)}">${m === 'all' ? '👥 Everyone' : (m === state.me ? '🙋 Me' : '👤 ' + esc(m))}</button>`).join('');
  document.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('active', b.dataset.sort === state.sort));

  const tasks = state.tasks.filter(t => isMine(t.assignee));
  const overdue = state.date === today ? state.overdue.filter(t => isMine(t.assignee)) : [];
  const done = tasks.filter(t => t.status === 'done').length;
  const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  $('#summary-text').textContent = tasks.length ? `${done} of ${tasks.length} tasks done` : 'No tasks yet';
  $('#summary-pct').textContent = tasks.length ? `${pct}%` : '';
  $('#summary-bar').style.width = `${pct}%`;

  let html = '';
  if (state.date !== today) html += `<div style="text-align:center;margin-bottom:8px"><button class="small-btn" data-action="go-today">↩ Back to today</button></div>`;
  if (overdue.length) {
    html += `<div class="section-title alert">⚠️ Overdue (${overdue.length})</div>` + overdue.map(t => taskCard(t, { overdue: true })).join('');
  }

  if (!tasks.length) {
    html += `<div class="empty"><span class="big">🌤️</span>Nothing planned.<br>Tap <b>+</b> to add a task.</div>`;
  } else if (state.sort === 'time') {
    const groups = {};
    tasks.slice().sort(byTime).forEach(t => {
      const s = slotOf(t.time);
      (groups[s.key] ||= { label: s.label, items: [] }).items.push(t);
    });
    for (const key of ['morning', 'afternoon', 'evening', 'any']) {
      const g = groups[key];
      if (g) html += `<div class="section-title">${g.label}</div>` + g.items.map(t => taskCard(t)).join('');
    }
  } else {
    for (const p of ['high', 'medium', 'low']) {
      const items = tasks.filter(t => t.priority === p).sort(byTime);
      if (items.length) html += `<div class="section-title">${LABELS.priority[p]}</div>` + items.map(t => taskCard(t)).join('');
    }
  }
  $('#task-list').innerHTML = html;
}

function dueText(iso, done) {
  if (!iso) return '';
  const late = !done && iso < todayISO();
  return `<span class="${late ? 'error' : ''}">${late ? '⚠️' : '📅'} ${esc(fmtDate(iso))}</span>`;
}

function renderProjects() {
  $('#view-title').textContent = 'Projects';
  document.querySelectorAll('[data-pfilter]').forEach(b => b.classList.toggle('active', b.dataset.pfilter === state.pfilter));

  const list = state.projects
    .filter(p => state.pfilter === 'all' || (state.pfilter === 'done' ? p.status === 'done' : p.status !== 'done'))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueDate || '9').localeCompare(b.dueDate || '9'));

  $('#project-list').innerHTML = list.length ? list.map(p => {
    const pending = p.works.filter(w => w.status !== 'done').length;
    const latest = p.updates[0];
    return `
      <button class="card project-card" data-action="open-project" data-id="${p._id}">
        <h3>${esc(p.name)}</h3>
        <div class="row">
          <span class="pill ${p.status}">${LABELS.project[p.status]}</span>
          <span class="pill ${p.priority}">${LABELS.priority[p.priority]}</span>
        </div>
        <div class="progress-label"><span>Progress</span><span>${p.progress}%</span></div>
        <div class="bar"><span style="width:${p.progress}%"></span></div>
        <div class="meta" style="margin-top:10px">
          ${p.owner ? `<span>👤 ${esc(p.owner)}</span>` : ''}
          ${dueText(p.dueDate, p.status === 'done')}
          <span>📌 ${pending} pending</span>
        </div>
        ${latest ? `<div class="latest">${LABELS.update[latest.type].split(' ')[0]} ${esc(latest.text)}</div>` : ''}
      </button>`;
  }).join('') : `<div class="empty"><span class="big">📁</span>No projects here.<br>Tap <b>+</b> to add one.</div>`;
}

function renderProject() {
  const p = state.projects.find(x => x._id === state.projectId);
  if (!p) { state.view = 'projects'; return render(); }
  $('#view-title').textContent = p.name;

  const works = p.works.slice().sort((a, b) =>
    (a.status === 'done') - (b.status === 'done') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const pending = works.filter(w => w.status !== 'done').length;

  $('#project-detail').innerHTML = `
    <div class="card detail-head">
      <div class="row">
        <span class="pill ${p.status}">${LABELS.project[p.status]}</span>
        <span class="pill ${p.priority}">${LABELS.priority[p.priority]}</span>
      </div>
      <div class="facts">
        <div><b>Owner</b>${esc(p.owner || '—')}</div>
        <div><b>Due date</b>${p.dueDate ? dueText(p.dueDate, p.status === 'done') : '—'}</div>
      </div>
      ${p.notes ? `<p class="muted" style="margin:12px 0 0;white-space:pre-wrap">${esc(p.notes)}</p>` : ''}
      <div class="slider-row">
        <span>📈</span>
        <input type="range" min="0" max="100" step="5" value="${p.progress}" style="--pct:${p.progress}%" data-action="progress" aria-label="Progress">
        <strong id="progress-val">${p.progress}%</strong>
      </div>
      <div class="btn-row">
        <button class="btn soft" data-action="edit-project">✏️ Edit project</button>
      </div>
    </div>

    <div class="section-title">📌 Pending works (${pending})</div>
    <div class="card">
      <form class="quick-add" data-form="add-work">
        <input name="title" placeholder="Add a work item…" required maxlength="200">
        <button class="btn primary">Add</button>
      </form>
      ${works.length ? works.map(w => `
        <div class="work ${w.status === 'done' ? 'is-done' : ''}">
          <button class="check ${w.status === 'done' ? 'on' : ''}" data-action="toggle-work" data-id="${w._id}" aria-label="Mark done">${w.status === 'done' ? '✓' : ''}</button>
          <div class="task-main" data-action="edit-work" data-id="${w._id}">
            <div class="task-title">${esc(w.title)}</div>
            <div class="meta">
              <span class="pill ${w.priority}">${LABELS.priority[w.priority]}</span>
              ${w.assignee ? `<span>👤 ${esc(w.assignee)}</span>` : ''}
              ${dueText(w.dueDate, w.status === 'done')}
            </div>
          </div>
          <button class="pill ${w.status}" data-action="cycle-work" data-id="${w._id}">${LABELS.work[w.status]}</button>
        </div>`).join('') : '<p class="muted" style="margin:4px 0">No pending works yet.</p>'}
    </div>

    <div class="section-title">📝 Updates</div>
    <div class="card">
      <form class="quick-add wrap" data-form="add-update">
        <select name="type" aria-label="Update type">
          ${Object.entries(LABELS.update).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
        <input name="text" placeholder="What changed?" required maxlength="2000">
        <button class="btn primary">Post</button>
      </form>
      ${p.updates.length ? p.updates.map(u => `
        <div class="update">
          <p>${LABELS.update[u.type].split(' ')[0]} ${esc(u.text)}</p>
          <div class="meta">
            <span>👤 ${esc(u.by || 'Someone')}</span><span>🕒 ${timeAgo(u.createdAt)}</span>
            <button class="small-btn" style="margin-left:auto;background:none;color:var(--muted)" data-action="delete-update" data-id="${u._id}">Delete</button>
          </div>
        </div>`).join('') : '<p class="muted" style="margin:4px 0">No updates yet.</p>'}
    </div>`;
}

// ---------- Bottom sheet forms ----------
function seg(name, options, value) {
  return `<div class="seg">${Object.entries(options).map(([k, v]) =>
    `<label><input type="radio" name="${name}" value="${esc(k)}" ${k === value ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('')}</div>`;
}
function peopleOptions() {
  return Object.fromEntries(people().map(p => [p, p === 'Both' ? '👥 Both' : (p === state.me ? '🙋 ' + p : p)]));
}

let sheetHandlers = {};
function openSheet(title, bodyHtml, { onSave, onDelete } = {}) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = bodyHtml;
  $('#sheet-delete').hidden = !onDelete;
  sheetHandlers = { onSave, onDelete };
  $('#sheet').showModal();
  const first = $('#sheet-body input[type=text]');
  if (first && !first.value) first.focus();
}
function closeSheet() { $('#sheet').close(); }

function formData() {
  return Object.fromEntries(new FormData($('#sheet-form')).entries());
}

function taskForm(t = {}) {
  const projectOpts = state.projects.filter(p => p.status !== 'done' || p._id === t.project?._id)
    .map(p => `<option value="${p._id}" ${t.project?._id === p._id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  return `
    <div class="field"><label>Task</label><input type="text" name="title" required maxlength="200" value="${esc(t.title)}" placeholder="What needs doing?"></div>
    <div class="two">
      <div class="field"><label>Date</label><input type="date" name="date" required value="${esc(t.date || state.date)}"></div>
      <div class="field"><label>Time</label><input type="time" name="time" value="${esc(t.time)}"></div>
    </div>
    <div class="field"><label>Priority</label>${seg('priority', LABELS.priority, t.priority || 'medium')}</div>
    ${t._id ? `<div class="field"><label>Status</label>${seg('status', LABELS.task, t.status)}</div>` : ''}
    <div class="field"><label>Who</label>${seg('assignee', peopleOptions(), t.assignee || state.me)}</div>
    <div class="field"><label>Project (optional)</label><select name="project"><option value="">— None —</option>${projectOpts}</select></div>
    <div class="field"><label>Notes</label><textarea name="notes" maxlength="2000">${esc(t.notes)}</textarea></div>`;
}

function newTask() {
  openSheet('➕ New task', taskForm(), {
    onSave: async d => {
      await api('POST', '/api/tasks', { ...d, project: d.project || null });
      toast('Task added');
      await refresh();
    },
  });
}

function editTask(id) {
  const t = [...state.tasks, ...state.overdue].find(x => x._id === id);
  if (!t) return;
  openSheet('✏️ Edit task', taskForm(t), {
    onSave: async d => {
      await api('PATCH', `/api/tasks/${id}`, d);
      toast('Saved');
      await refresh();
    },
    onDelete: async () => {
      await api('DELETE', `/api/tasks/${id}`);
      toast('Task deleted');
      await refresh();
    },
  });
}

function projectForm(p = {}) {
  return `
    <div class="field"><label>Project name</label><input type="text" name="name" required maxlength="120" value="${esc(p.name)}"></div>
    <div class="field"><label>Status</label>${seg('status', LABELS.project, p.status || 'planning')}</div>
    <div class="field"><label>Priority</label>${seg('priority', LABELS.priority, p.priority || 'medium')}</div>
    <div class="field"><label>Owner</label>${seg('owner', peopleOptions(), p.owner || state.me)}</div>
    <div class="two">
      <div class="field"><label>Due date</label><input type="date" name="dueDate" value="${esc(p.dueDate)}"></div>
      <div class="field"><label>Progress %</label><input type="number" name="progress" min="0" max="100" step="5" value="${p.progress ?? 0}"></div>
    </div>
    <div class="field"><label>Notes</label><textarea name="notes" maxlength="2000">${esc(p.notes)}</textarea></div>`;
}

function newProject() {
  openSheet('➕ New project', projectForm(), {
    onSave: async d => {
      const p = await api('POST', '/api/projects', { ...d, progress: Number(d.progress) });
      replaceProject(p);
      state.view = 'project';
      state.projectId = p._id;
      toast('Project created');
      render();
    },
  });
}

function editProject() {
  const p = state.projects.find(x => x._id === state.projectId);
  openSheet('✏️ Edit project', projectForm(p), {
    onSave: async d => {
      replaceProject(await api('PATCH', `/api/projects/${p._id}`, { ...d, progress: Number(d.progress) }));
      toast('Saved');
      render();
    },
    onDelete: async () => {
      if (!confirm(`Delete "${p.name}" and all of its pending works and updates?`)) throw new Error('cancelled');
      await api('DELETE', `/api/projects/${p._id}`);
      state.view = 'projects';
      toast('Project deleted');
      await refresh();
    },
  });
}

function workForm(w = {}) {
  return `
    <div class="field"><label>Work item</label><input type="text" name="title" required maxlength="200" value="${esc(w.title)}"></div>
    <div class="field"><label>Status</label>${seg('status', LABELS.work, w.status || 'todo')}</div>
    <div class="field"><label>Priority</label>${seg('priority', LABELS.priority, w.priority || 'medium')}</div>
    <div class="field"><label>Assigned to</label>${seg('assignee', peopleOptions(), w.assignee || state.me)}</div>
    <div class="field"><label>Due date</label><input type="date" name="dueDate" value="${esc(w.dueDate)}"></div>`;
}

function newWork() {
  openSheet('➕ New pending work', workForm(), {
    onSave: async d => {
      replaceProject(await api('POST', `/api/projects/${state.projectId}/works`, d));
      toast('Work item added');
      render();
    },
  });
}

function editWork(wid) {
  const p = state.projects.find(x => x._id === state.projectId);
  const w = p.works.find(x => x._id === wid);
  openSheet('✏️ Edit work item', workForm(w), {
    onSave: async d => {
      replaceProject(await api('PATCH', `/api/projects/${p._id}/works/${wid}`, d));
      toast('Saved');
      render();
    },
    onDelete: async () => {
      replaceProject(await api('DELETE', `/api/projects/${p._id}/works/${wid}`));
      toast('Deleted');
      render();
    },
  });
}

// ---------- Events ----------
async function setTask(id, changes) {
  await api('PATCH', `/api/tasks/${id}`, changes);
  await refresh();
}
async function setWork(wid, changes) {
  replaceProject(await api('PATCH', `/api/projects/${state.projectId}/works/${wid}`, changes));
  render();
}

const actions = {
  'toggle-task': id => {
    const t = [...state.tasks, ...state.overdue].find(x => x._id === id);
    return setTask(id, { status: t.status === 'done' ? 'todo' : 'done' });
  },
  'cycle-task': id => setTask(id, { status: NEXT_STATUS[state.tasks.find(x => x._id === id).status] }),
  'move-today': id => setTask(id, { date: todayISO() }).then(() => toast('Moved to today')),
  'edit-task': editTask,
  'go-today': () => { state.date = todayISO(); return refresh(); },
  'open-project': id => { state.view = 'project'; state.projectId = id; render(); window.scrollTo(0, 0); },
  'edit-project': editProject,
  'toggle-work': wid => {
    const w = state.projects.find(x => x._id === state.projectId).works.find(x => x._id === wid);
    return setWork(wid, { status: w.status === 'done' ? 'todo' : 'done' });
  },
  'cycle-work': wid => {
    const w = state.projects.find(x => x._id === state.projectId).works.find(x => x._id === wid);
    return setWork(wid, { status: NEXT_STATUS[w.status] });
  },
  'edit-work': editWork,
  'delete-update': async uid => {
    if (!confirm('Delete this update?')) return;
    replaceProject(await api('DELETE', `/api/projects/${state.projectId}/updates/${uid}`));
    render();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    Promise.resolve(actions[el.dataset.action](el.dataset.id)).catch(err => toast(err.message));
    return;
  }
  const t = e.target.closest('[data-who],[data-sort],[data-pfilter],[data-tab],[data-day],[data-member]');
  if (!t) return;
  if (t.dataset.member) return signIn(t.dataset.member);
  if (t.dataset.who) { state.who = t.dataset.who; localStorage.setItem('tt-who', state.who); renderToday(); }
  if (t.dataset.sort) { state.sort = t.dataset.sort; localStorage.setItem('tt-sort', state.sort); renderToday(); }
  if (t.dataset.pfilter) { state.pfilter = t.dataset.pfilter; renderProjects(); }
  if (t.dataset.tab) { state.view = t.dataset.tab; render(); window.scrollTo(0, 0); }
  if (t.dataset.day) { state.date = addDays(state.date, Number(t.dataset.day)); safeRefresh(); }
});

// Progress slider: show the value live, save when released.
document.addEventListener('input', e => {
  if (e.target.dataset.action !== 'progress') return;
  $('#progress-val').textContent = `${e.target.value}%`;
  e.target.style.setProperty('--pct', `${e.target.value}%`);
});
document.addEventListener('change', async e => {
  if (e.target.dataset.action !== 'progress') return;
  try {
    replaceProject(await api('PATCH', `/api/projects/${state.projectId}`, { progress: Number(e.target.value) }));
    toast(`Progress set to ${e.target.value}%`);
  } catch (err) { toast(err.message); }
});

// Quick-add forms on the project page.
document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form).entries());
  try {
    const url = `/api/projects/${state.projectId}/${form.dataset.form === 'add-work' ? 'works' : 'updates'}`;
    replaceProject(await api('POST', url, d));
    render();
    toast(form.dataset.form === 'add-work' ? 'Work item added' : 'Update posted');
  } catch (err) { toast(err.message); }
});

// Tapping the date opens the device's date picker.
const picker = Object.assign(document.createElement('input'), { type: 'date' });
picker.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:50%;top:80px';
document.body.appendChild(picker);
$('#date-label').addEventListener('click', () => {
  picker.value = state.date;
  if (picker.showPicker) picker.showPicker(); else picker.click();
});
picker.addEventListener('change', () => { if (picker.value) { state.date = picker.value; safeRefresh(); } });

$('#fab').addEventListener('click', () => {
  if (state.view === 'today') newTask();
  else if (state.view === 'projects') newProject();
  else newWork();
});
$('#back-btn').addEventListener('click', () => { state.view = 'projects'; render(); });
$('#me-btn').addEventListener('click', () => { if (confirm(`Signed in as ${state.me}. Switch user?`)) signOut(); });

$('#sheet-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { await sheetHandlers.onSave(formData()); closeSheet(); } catch (err) { toast(err.message); }
});
$('#sheet-cancel').addEventListener('click', closeSheet);
$('#sheet-delete').addEventListener('click', async () => {
  try { await sheetHandlers.onDelete(); closeSheet(); } catch (err) { if (err.message !== 'cancelled') toast(err.message); }
});
// Tap on the dark backdrop closes the sheet.
$('#sheet').addEventListener('click', e => { if (e.target === $('#sheet')) closeSheet(); });

// ---------- Live sync between both members ----------
// Re-fetch every few seconds while the app is visible, and right away when it comes back to the foreground.
setInterval(() => {
  // Skip while someone is typing or dragging so their input isn't wiped by a re-render.
  const busy = $('#sheet').open || document.activeElement?.matches('input, textarea, select');
  if (state.me && !document.hidden && !busy) safeRefresh();
}, SYNC_EVERY_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.me) safeRefresh();
});

// ---------- Boot ----------
(async () => {
  try {
    state.config = await fetch('/api/config').then(r => r.json());
  } catch {
    state.config = null;
  }
  if (!state.config || state.config.dbError) {
    $('#login').hidden = false;
    const err = $('#login-error');
    err.textContent = '⚠️ ' + (state.config ? state.config.dbError : 'Cannot reach the server. Check your internet connection.');
    err.hidden = false;
    return;
  }
  if (state.me && state.config.members.includes(state.me)) startApp();
  else showLogin();
})();
