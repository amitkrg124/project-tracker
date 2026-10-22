// Team Tracker front end: plain JavaScript, no build step. Styles come from app.css (Tailwind + daisyUI).
'use strict';

const LABELS = {
  priority: { high: 'High', medium: 'Medium', low: 'Low' },
  task: { todo: 'To do', doing: 'Doing', done: 'Done', postponed: 'Later' },
  project: { planning: 'Planning', active: 'Active', hold: 'On hold', done: 'Done' },
  work: { todo: 'To do', doing: 'Doing', blocked: 'Blocked', done: 'Done' },
  update: { progress: 'Progress', issue: 'Issue', decision: 'Decision' },
  reminder: { '-1': 'No reminder', 0: 'At start time', 5: '5 min before', 15: '15 min before', 30: '30 min before', 60: '1 hour before' },
};
// Full class names (not built from parts) so Tailwind can find them.
const STATUS_BADGE = {
  todo: 'badge-ghost', doing: 'badge-info badge-soft', done: 'badge-success badge-soft',
  postponed: 'badge-neutral badge-outline', blocked: 'badge-error badge-soft',
};
const PROJECT_BADGE = { planning: 'badge-ghost', active: 'badge-primary badge-soft', hold: 'badge-warning badge-soft', done: 'badge-success badge-soft' };
const UPDATE_STYLE = {
  progress: { icon: 'circle-check', cls: 'text-success' },
  issue: { icon: 'triangle-alert', cls: 'text-warning' },
  decision: { icon: 'lightbulb', cls: 'text-info' },
};
const NOTICE_STYLE = {
  task: { icon: 'user-plus', cls: 'bg-primary/10 text-primary' },
  work: { icon: 'folder', cls: 'bg-primary/10 text-primary' },
  reminder: { icon: 'alarm-clock', cls: 'bg-warning/15 text-warning' },
  digest: { icon: 'sun', cls: 'bg-accent/15 text-accent' },
};
const MEMBER_TONES = ['bg-accent text-accent-content', 'bg-secondary text-secondary-content'];
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
  ptab: 'works',
  projectId: null,
  projects: [],
  tasks: [],
  overdue: [],
  notifications: [],
  pushOn: false,
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
function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}
function fmtDate(iso, opts = { day: 'numeric', month: 'short' }) {
  return iso ? parseISO(iso).toLocaleDateString('en-IN', opts) : '';
}
function timeParts(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return { clock: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, half: h < 12 ? 'AM' : 'PM' };
}
function fmtTime(hhmm) {
  if (!hhmm) return '';
  const { clock, half } = timeParts(hhmm);
  return `${clock} ${half}`;
}
function timeAgo(ts) {
  const mins = Math.round((Date.now() - new Date(ts)) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function slotOf(time) {
  if (!time) return { key: 'any', label: 'Anytime' };
  const h = Number(time.slice(0, 2));
  if (h < 12) return { key: 'morning', label: 'Morning' };
  if (h < 17) return { key: 'afternoon', label: 'Afternoon' };
  return { key: 'evening', label: 'Evening' };
}
function byTime(a, b) {
  if (a.time !== b.time) return !a.time ? 1 : !b.time ? -1 : a.time.localeCompare(b.time);
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}
function isMine(assignee) {
  return state.who === 'all' || assignee === state.who || assignee === 'Both';
}
function people() {
  return [...state.config.members, 'Both'];
}

// ---------- Small UI pieces ----------
function icon(name, cls = 'size-4') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}
// Swap <i data-icon="name"> placeholders in static HTML for SVGs.
function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon, el.className); });
}
function memberTone(name) {
  return MEMBER_TONES[state.config.members.indexOf(name)] || 'bg-neutral text-neutral-content';
}
// Both names start with "A", so use two letters.
function initials(name) {
  return esc(name.slice(0, 2));
}
function avatar(name, size = 'size-5 text-[9px]') {
  const inner = name === 'Both' ? icon('users', 'size-3') : initials(name);
  return `<span class="inline-grid shrink-0 place-items-center rounded-full font-bold leading-none ${size} ${memberTone(name)}">${inner}</span>`;
}
function person(name) {
  return name ? `<span class="inline-flex items-center gap-1.5">${avatar(name)}${esc(name)}</span>` : '';
}
function dueText(iso, done) {
  if (!iso) return '';
  const late = !done && iso < todayISO();
  return `<span class="inline-flex items-center gap-1 ${late ? 'font-medium text-error' : ''}">${icon(late ? 'triangle-alert' : 'calendar-days')}${late ? 'Late, ' : ''}${esc(fmtDate(iso))}</span>`;
}
function highFlag(priority) {
  return priority === 'high' ? `<span class="inline-flex items-center gap-1 font-medium text-error">${icon('flag')}High</span>` : '';
}
function sectionTitle(text, count, cls = '') {
  return `<h2 class="mt-7 mb-2 flex items-baseline gap-2 px-1 font-display text-base font-semibold ${cls}">${text}<span class="tabular text-sm font-normal opacity-60">${count}</span></h2>`;
}
function emptyState(iconName, text, action = '') {
  return `
    <div class="mt-12 text-center">
      <div class="mx-auto grid size-14 place-items-center rounded-full bg-base-100 text-base-content/40">${icon(iconName, 'size-6')}</div>
      <p class="mt-4 font-medium">${text}</p>
      ${action}
    </div>`;
}

function toast(msg, tone = '') {
  const el = document.createElement('div');
  el.className = `alert py-2.5 text-sm shadow-lg ${tone === 'error' ? 'alert-error' : 'border-0 bg-neutral text-neutral-content'}`;
  el.textContent = msg;
  $('#toast').replaceChildren(el);
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.remove(), 2600);
}
const toastError = err => toast(err.message, 'error');

// ---------- API ----------
function setSync(cls, title) {
  const s = $('#sync');
  s.className = `status ${cls}`;
  s.title = title;
}
async function api(method, url, body) {
  setSync('status-warning', 'Saving…');
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-passcode': state.passcode, 'x-member': state.me },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { signOut(); throw new Error('Please sign in again'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    setSync('status-success', `Synced ${new Date().toLocaleTimeString()}`);
    return data;
  } catch (err) {
    setSync('status-error', 'Offline: changes are not saved');
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
    loadNotifications(),
  ]);
  state.projects = projects;
  state.tasks = taskData.tasks;
  state.overdue = taskData.overdue;
  render();
}
const safeRefresh = () => refresh().catch(toastError);

// Unfinished works from projects that are not done yet, shown on the Today screen.
function openProjectWorks() {
  return state.projects.filter(p => p.status !== 'done')
    .flatMap(p => p.works.filter(w => w.status !== 'done').map(w => ({ ...w, project: p })))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueDate || '9').localeCompare(b.dueDate || '9'));
}
function findWork(wid, pid = state.projectId) {
  return state.projects.find(x => x._id === pid).works.find(x => x._id === wid);
}

// ---------- Deep links (from notifications) ----------
// #/today/2026-10-23, #/project/<id>, #/projects, #/inbox
function openLink(url) {
  const [, view, arg] = (String(url).split('#')[1] || '').split('/');
  if (view === 'project' && arg) { state.view = 'project'; state.projectId = arg; state.ptab = 'works'; }
  else if (view === 'today') { state.view = 'today'; state.date = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : todayISO(); }
  else if (view === 'projects' || view === 'inbox') state.view = view;
  else return false;
  if (location.hash) history.replaceState(null, '', location.pathname);
  return true;
}

// ---------- Notifications ----------
async function loadNotifications() {
  state.notifications = await api('GET', '/api/notifications');
  const unread = state.notifications.filter(n => !n.read).length;
  $('#bell-count').textContent = unread > 9 ? '9+' : unread;
  $('#bell-count').hidden = !unread;

  // Alert only about notifications that arrived since we last checked.
  const key = `tt-seen-${state.me}`;
  const seen = localStorage.getItem(key);
  if (state.notifications[0]) localStorage.setItem(key, state.notifications[0].createdAt);
  else if (seen === null) localStorage.setItem(key, '');
  if (seen === null) return; // first time on this device: don't replay old ones
  const fresh = state.notifications.filter(n => !n.read && n.createdAt > seen);
  if (!fresh.length) return;
  toast(fresh.length === 1 ? fresh[0].heading : `${fresh.length} new notifications`);
  if (state.view === 'inbox') renderInbox();
  // Push already showed these on devices where it is on.
  if (!state.pushOn) fresh.slice(0, 3).forEach(showLocalNotification);
}

async function showLocalNotification(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: n.body, icon: 'icon-192.png', badge: 'badge-72.png', tag: n._id, data: { url: n.url } };
    if (reg) await reg.showNotification(n.heading, opts);
    else new Notification(n.heading, opts);
  } catch { /* the toast is enough */ }
}

// ---------- Web push ----------
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64) {
  const b64 = (base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function sameKey(a, b) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(state.config.vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  // The server's key changed (new VAPID keys): start a fresh subscription.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('POST', '/api/push/subscribe', sub.toJSON());
  state.pushOn = true;
}

// Must run straight from a tap: iPhone only shows the permission prompt then.
async function enablePush() {
  if (!state.config.vapidPublicKey) throw new Error('Notifications are not set up on the server yet (VAPID keys missing).');
  if (!pushSupported()) {
    throw new Error(isIOS && !isStandalone
      ? 'On iPhone, add the app to your Home Screen first, then turn notifications on from there.'
      : 'This browser cannot show notifications.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in your browser settings.');
  await subscribePush();
  toast('Notifications are on');
  render();
}

async function disablePush() {
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  if (sub) {
    await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  state.pushOn = false;
}

// On start, quietly link this device's subscription to whoever is signed in.
async function syncPush() {
  if (!state.config.vapidPublicKey || !pushSupported() || Notification.permission !== 'granted') return;
  try { await subscribePush(); } catch (err) { state.pushOn = false; console.warn('Push subscription failed:', err); }
  render();
}

// ---------- Sign in ----------
function showLogin() {
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#passcode-wrap').hidden = !state.config.needsPasscode;
  $('#member-buttons').innerHTML = state.config.members.map(m => `
    <button class="btn btn-lg h-16 justify-start gap-4 border-base-300 bg-base-100 text-lg font-semibold" data-member="${esc(m)}">
      ${avatar(m, 'size-10 text-sm')}${esc(m)}${icon('chevron-right', 'ml-auto size-5 opacity-40')}
    </button>`).join('');
}

async function signIn(member) {
  const passcode = $('#passcode').value;
  const err = $('#login-error');
  err.hidden = true;
  try {
    if (state.config.needsPasscode) {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) });
      if (!res.ok) throw new Error('Wrong passcode. Ask your teammate for it.');
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

async function signOut() {
  if (state.pushOn) await disablePush().catch(() => {});
  localStorage.removeItem('tt-me');
  localStorage.removeItem('tt-passcode');
  state.me = '';
  state.passcode = '';
  state.notifications = [];
  showLogin();
}

function startApp() {
  $('#boot').hidden = true;
  $('#login').hidden = true;
  $('#app').hidden = false;
  const av = $('#me-avatar');
  av.className = `grid size-9 place-items-center rounded-full text-sm font-bold ${memberTone(state.me)}`;
  av.innerHTML = initials(state.me);
  $('#me-btn').title = `Signed in as ${state.me}`;
  openLink(location.href);
  safeRefresh();
  syncPush();
}

// ---------- Render ----------
const TITLES = { projects: 'Projects', inbox: 'Inbox' };

function render() {
  for (const v of ['today', 'projects', 'project', 'inbox']) $(`#view-${v}`).hidden = state.view !== v;
  $('#back-btn').hidden = state.view !== 'project';
  $('#fab').hidden = state.view === 'inbox';
  $('#go-today').hidden = !(state.view === 'today' && state.date !== todayISO());
  document.querySelectorAll('.dock [data-tab]').forEach(b => {
    const on = b.dataset.tab === state.view || (state.view === 'project' && b.dataset.tab === 'projects');
    b.classList.toggle('dock-active', on);
    b.toggleAttribute('aria-current', on);
  });
  if (TITLES[state.view]) $('#view-title').textContent = TITLES[state.view];

  if (state.view === 'today') renderToday();
  else if (state.view === 'projects') renderProjects();
  else if (state.view === 'project') renderProject();
  else renderInbox();
}

function relativeDay(iso) {
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

function renderWeek() {
  const d = parseISO(state.date);
  const start = addDays(state.date, -((d.getDay() + 6) % 7)); // Monday
  const today = todayISO();
  $('#week').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(start, i);
    const cls = iso === state.date ? 'is-selected' : iso === today ? 'is-today' : '';
    return `
      <button class="day ${cls}" data-date="${iso}" aria-label="${esc(fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' }))}" ${iso === state.date ? 'aria-current="date"' : ''}>
        <span class="text-[11px] font-medium opacity-70">${fmtDate(iso, { weekday: 'narrow' })}</span>
        <span class="tabular font-display text-base font-semibold">${parseISO(iso).getDate()}</span>
      </button>`;
  }).join('');
}

function renderPushBanner() {
  const el = $('#push-banner');
  const show = state.config.vapidPublicKey && !state.pushOn && localStorage.getItem('tt-push-dismissed') !== '1'
    && (pushSupported() || isIOS);
  if (!show) { el.innerHTML = ''; return; }
  const blocked = 'Notification' in window && Notification.permission === 'denied';
  const needsInstall = isIOS && !isStandalone;
  const text = blocked ? 'Notifications are blocked for this site. Allow them in your browser settings to get reminders.'
    : needsInstall ? 'On iPhone, tap Share, then Add to Home Screen. Open the app from there to turn notifications on.'
    : 'Hear about new work and task reminders, even when the app is closed.';
  el.innerHTML = `
    <div role="alert" class="mt-5 flex gap-3 rounded-box border border-primary/20 bg-primary/5 p-4 text-sm">
      ${icon('bell-ring', 'mt-0.5 size-5 shrink-0 text-primary')}
      <div class="flex-1">
        <div class="font-semibold">Get notified</div>
        <p class="mt-0.5 text-base-content/70">${text}</p>
        ${blocked || needsInstall ? '' : '<button class="btn btn-primary btn-sm mt-3" data-action="enable-push">Turn on notifications</button>'}
      </div>
      <button class="btn btn-square btn-ghost btn-sm -mt-1 -mr-1" data-action="dismiss-push" aria-label="Dismiss">${icon('x')}</button>
    </div>`;
}

function taskRow(t, { overdue = false, showTime = false } = {}) {
  const done = t.status === 'done';
  const meta = [
    overdue ? `<span class="font-medium text-error">${esc(fmtDate(t.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>` : '',
    !showTime && t.time ? `<span class="inline-flex items-center gap-1">${icon('clock')}${esc(fmtTime(t.time))}</span>` : '',
    highFlag(t.priority),
    person(t.assignee),
    t.project ? `<span class="inline-flex items-center gap-1">${icon('folder')}${esc(t.project.name)}</span>` : '',
    t.time && t.reminder >= 0 && !done ? `<span class="inline-flex items-center gap-1" title="Reminder">${icon('alarm-clock')}${LABELS.reminder[t.reminder]}</span>` : '',
  ].join('');
  let timeCol = '';
  if (showTime) {
    const p = t.time && timeParts(t.time);
    timeCol = `<div class="w-11 text-right font-display leading-tight">${p ? `<div class="tabular font-semibold">${p.clock}</div><div class="text-[11px] opacity-50">${p.half}</div>` : ''}</div>`;
  }
  return `
    <li class="list-row items-center gap-3 px-3 py-3">
      ${timeCol}
      <button class="tick ${t.priority} ${done ? 'on' : ''}" data-action="toggle-task" data-id="${t._id}" aria-label="${done ? 'Mark not done' : 'Mark done'}" aria-pressed="${done}">${icon('check', 'size-4')}</button>
      <div class="list-col-grow min-w-0 cursor-pointer" data-action="edit-task" data-id="${t._id}">
        <div class="font-medium leading-snug ${done ? 'text-base-content/50 line-through' : ''}">${esc(t.title)}</div>
        ${meta ? `<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/60">${meta}</div>` : ''}
      </div>
      ${overdue
        ? `<button class="btn btn-soft btn-primary btn-xs" data-action="move-today" data-id="${t._id}">Move to today</button>`
        : `<button class="badge h-7 cursor-pointer whitespace-nowrap ${STATUS_BADGE[t.status]}" data-action="cycle-task" data-id="${t._id}" aria-label="Status: ${LABELS.task[t.status]}. Tap to change">${LABELS.task[t.status]}</button>`}
    </li>`;
}

function workRow(w, pid, { showProject = false } = {}) {
  const done = w.status === 'done';
  const meta = [
    showProject ? `<span class="inline-flex items-center gap-1">${icon('folder')}${esc(w.project.name)}</span>` : '',
    highFlag(w.priority),
    person(w.assignee),
    dueText(w.dueDate, done),
  ].join('');
  const open = showProject ? `data-action="open-project" data-id="${pid}"` : `data-action="edit-work" data-id="${w._id}"`;
  return `
    <li class="list-row items-center gap-3 px-3 py-3">
      <button class="tick ${w.priority} ${done ? 'on' : ''}" data-action="toggle-work" data-id="${w._id}" data-pid="${pid}" aria-label="${done ? 'Mark not done' : 'Mark done'}" aria-pressed="${done}">${icon('check', 'size-4')}</button>
      <div class="list-col-grow min-w-0 cursor-pointer" ${open}>
        <div class="font-medium leading-snug ${done ? 'text-base-content/50 line-through' : ''}">${esc(w.title)}</div>
        ${meta ? `<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/60">${meta}</div>` : ''}
      </div>
      <button class="badge h-7 cursor-pointer whitespace-nowrap ${STATUS_BADGE[w.status]}" data-action="cycle-work" data-id="${w._id}" data-pid="${pid}" aria-label="Status: ${LABELS.work[w.status]}. Tap to change">${LABELS.work[w.status]}</button>
    </li>`;
}

const list = rows => `<ul class="list rounded-box bg-base-100">${rows}</ul>`;

function renderToday() {
  const today = todayISO();
  $('#view-title').textContent = relativeDay(state.date);
  $('#date-weekday').textContent = fmtDate(state.date, { weekday: 'long' });
  $('#date-day').textContent = parseISO(state.date).getDate();
  $('#date-month').textContent = fmtDate(state.date, { month: 'long', ...(state.date.slice(0, 4) !== today.slice(0, 4) && { year: 'numeric' }) });
  renderWeek();
  renderPushBanner();

  $('#who-filter').innerHTML = ['all', ...state.config.members].map(m => `
    <button class="join-item btn btn-sm flex-1 ${state.who === m ? 'btn-neutral' : 'bg-base-100'}" data-who="${esc(m)}" aria-pressed="${state.who === m}">
      ${m === 'all' ? 'Everyone' : `${avatar(m, 'size-4 text-[8px]')}${esc(m)}`}
    </button>`).join('');
  $('#sort-btn').innerHTML = state.sort === 'time' ? `${icon('clock')}By time` : `${icon('arrow-down-wide-narrow')}By priority`;

  const tasks = state.tasks.filter(t => isMine(t.assignee));
  const overdue = state.date === today ? state.overdue.filter(t => isMine(t.assignee)) : [];
  const works = state.date === today ? openProjectWorks().filter(w => isMine(w.assignee)) : [];
  const done = tasks.filter(t => t.status === 'done').length;
  $('#summary-text').textContent = tasks.length ? `${done} of ${tasks.length} done` : 'Nothing planned';
  $('#summary-bar').value = tasks.length ? Math.round(done / tasks.length * 100) : 0;

  let html = '';
  if (overdue.length) html += sectionTitle('Overdue', overdue.length, 'text-error') + list(overdue.map(t => taskRow(t, { overdue: true })).join(''));

  if (state.sort === 'time') {
    const groups = {};
    tasks.slice().sort(byTime).forEach(t => {
      const s = slotOf(t.time);
      (groups[s.key] ||= { label: s.label, items: [] }).items.push(t);
    });
    for (const key of ['morning', 'afternoon', 'evening', 'any']) {
      const g = groups[key];
      if (g) html += sectionTitle(g.label, g.items.length) + list(g.items.map(t => taskRow(t, { showTime: true })).join(''));
    }
  } else {
    for (const p of ['high', 'medium', 'low']) {
      const items = tasks.filter(t => t.priority === p).sort(byTime);
      if (items.length) html += sectionTitle(`${LABELS.priority[p]} priority`, items.length) + list(items.map(t => taskRow(t)).join(''));
    }
  }
  if (works.length) html += sectionTitle('Project work', works.length) + list(works.map(w => workRow(w, w.project._id, { showProject: true })).join(''));

  if (!tasks.length && !works.length && !overdue.length) {
    const who = state.who === 'all' ? '' : ` for ${esc(state.who)}`;
    html += emptyState('calendar-days', `Nothing planned${who} on this day`,
      '<button class="btn btn-primary btn-sm mt-4" data-action="new-task">Add a task</button>');
  }
  $('#task-list').innerHTML = html;
}

function renderProjects() {
  document.querySelectorAll('[name=pfilter]').forEach(r => { r.checked = r.value === state.pfilter; });
  const items = state.projects
    .filter(p => state.pfilter === 'all' || (state.pfilter === 'done' ? p.status === 'done' : p.status !== 'done'))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueDate || '9').localeCompare(b.dueDate || '9'));

  $('#project-list').innerHTML = items.length ? items.map(p => {
    const open = p.works.filter(w => w.status !== 'done').length;
    const latest = p.updates[0];
    return `
      <a class="card bg-base-100 transition-transform active:scale-[.99]" href="#/project/${p._id}" data-action="open-project" data-id="${p._id}">
        <div class="card-body gap-3 p-5">
          <div class="flex items-start gap-3">
            <h3 class="flex-1 font-display text-lg leading-snug font-semibold">${esc(p.name)}</h3>
            <span class="badge ${PROJECT_BADGE[p.status]}">${LABELS.project[p.status]}</span>
          </div>
          <div class="flex items-center gap-3">
            <progress class="progress progress-primary h-1.5 flex-1" value="${p.progress}" max="100"></progress>
            <span class="tabular font-display text-sm font-semibold">${p.progress}%</span>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-base-content/60">
            ${person(p.owner)}
            ${dueText(p.dueDate, p.status === 'done')}
            <span class="inline-flex items-center gap-1">${icon('list-checks')}${open ? `${open} open` : 'No open'} work${open === 1 ? '' : 's'}</span>
            ${highFlag(p.priority)}
          </div>
          ${latest ? `<p class="line-clamp-2 border-l-2 border-base-300 pl-3 text-sm text-base-content/70">${esc(latest.text)}</p>` : ''}
        </div>
      </a>`;
  }).join('') : emptyState('folder-kanban', state.pfilter === 'done' ? 'No finished projects yet' : 'No projects yet',
    state.pfilter === 'done' ? '' : '<button class="btn btn-primary btn-sm mt-4" data-action="new-project">Add a project</button>');
}

function renderProject() {
  const p = state.projects.find(x => x._id === state.projectId);
  if (!p) { state.view = 'projects'; return render(); }
  $('#view-title').textContent = p.name;

  const works = p.works.slice().sort((a, b) =>
    (a.status === 'done') - (b.status === 'done') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const open = works.filter(w => w.status !== 'done').length;
  const tab = (key, label, count) =>
    `<button role="tab" class="tab gap-2 ${state.ptab === key ? 'tab-active' : ''}" data-ptab="${key}" aria-selected="${state.ptab === key}">${label}<span class="tabular opacity-60">${count}</span></button>`;

  const worksPanel = `
    <form class="join mt-4 w-full" data-form="add-work">
      <input name="title" class="input join-item min-w-0 flex-1" placeholder="Add a work item" required maxlength="200" aria-label="New work item">
      <select name="assignee" class="select join-item w-28" aria-label="Assign to">
        <option value="">No one</option>
        ${people().map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
      </select>
      <button class="btn btn-primary join-item" aria-label="Add work item">${icon('plus', 'size-5')}</button>
    </form>
    <div class="mt-3">${works.length ? list(works.map(w => workRow(w, p._id)).join('')) : '<p class="px-1 py-6 text-center text-sm text-base-content/60">No work items yet. Add the first one above.</p>'}</div>`;

  const updatesPanel = `
    <form class="card mt-4 bg-base-100" data-form="add-update">
      <div class="card-body gap-3 p-4">
        <textarea name="text" class="textarea w-full" rows="2" placeholder="What changed?" required maxlength="2000" aria-label="Update"></textarea>
        <div class="flex items-center gap-2">
          <select name="type" class="select select-sm w-auto" aria-label="Update type">
            ${Object.entries(LABELS.update).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm ml-auto">${icon('send')}Post update</button>
        </div>
      </div>
    </form>
    ${p.updates.length ? `<ul class="mt-3 grid gap-2">${p.updates.map(u => `
      <li class="flex gap-3 rounded-box bg-base-100 p-4">
        <span class="${UPDATE_STYLE[u.type].cls} mt-0.5" title="${LABELS.update[u.type]}">${icon(UPDATE_STYLE[u.type].icon, 'size-5')}</span>
        <div class="min-w-0 flex-1">
          <p class="break-words whitespace-pre-wrap">${esc(u.text)}</p>
          <div class="mt-2 flex items-center gap-3 text-xs text-base-content/60">
            ${person(u.by || 'Someone')}<span>${timeAgo(u.createdAt)}</span>
            <button class="btn btn-square btn-ghost btn-xs ml-auto" data-action="delete-update" data-id="${u._id}" aria-label="Delete update">${icon('trash-2')}</button>
          </div>
        </div>
      </li>`).join('')}</ul>` : '<p class="px-1 py-6 text-center text-sm text-base-content/60">No updates yet. Post progress, issues, or decisions here.</p>'}`;

  $('#project-detail').innerHTML = `
    <div class="card mt-1 bg-base-100">
      <div class="card-body gap-4 p-5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="badge ${PROJECT_BADGE[p.status]}">${LABELS.project[p.status]}</span>
          <span class="badge badge-ghost">${LABELS.priority[p.priority]} priority</span>
          <button class="btn btn-ghost btn-sm ml-auto" data-action="edit-project">${icon('pencil')}Edit</button>
        </div>
        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div><dt class="text-base-content/60">Owner</dt><dd class="mt-1 font-medium">${p.owner ? person(p.owner) : 'No owner'}</dd></div>
          <div><dt class="text-base-content/60">Due</dt><dd class="mt-1 font-medium">${p.dueDate ? dueText(p.dueDate, p.status === 'done') : 'No due date'}</dd></div>
        </dl>
        ${p.notes ? `<p class="whitespace-pre-wrap text-sm text-base-content/80">${esc(p.notes)}</p>` : ''}
        <div>
          <div class="flex items-baseline justify-between text-sm"><span class="text-base-content/60">Progress</span><strong id="progress-val" class="tabular font-display text-lg">${p.progress}%</strong></div>
          <input type="range" min="0" max="100" step="5" value="${p.progress}" class="range range-primary range-sm mt-2 w-full" data-action="progress" aria-label="Progress">
        </div>
      </div>
    </div>
    <div role="tablist" class="tabs-box tabs mt-6 bg-base-300/60">${tab('works', 'Works', open)}${tab('updates', 'Updates', p.updates.length)}</div>
    ${state.ptab === 'works' ? worksPanel : updatesPanel}`;
}

function renderInbox() {
  const items = state.notifications;
  const unread = items.some(n => !n.read);
  $('#inbox').innerHTML = items.length ? `
    <div class="mt-1 mb-3 flex items-center justify-between px-1">
      <p class="text-sm text-base-content/60">Work given to you and reminders</p>
      ${unread ? `<button class="btn btn-ghost btn-sm text-primary" data-action="read-all">${icon('check-check')}Mark all read</button>` : ''}
    </div>
    ${list(items.map(n => {
      const s = NOTICE_STYLE[n.kind] || NOTICE_STYLE.task;
      return `
        <li class="list-row cursor-pointer items-start gap-3 px-3 py-3" data-action="open-notice" data-id="${n._id}">
          <span class="grid size-10 place-items-center rounded-full ${s.cls}">${icon(s.icon, 'size-5')}</span>
          <div class="list-col-grow min-w-0">
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 ${n.read ? 'font-medium text-base-content/80' : 'font-semibold'}">${esc(n.heading)}</span>
              ${n.read ? '' : '<span class="unread-dot" aria-label="Unread"></span>'}
            </div>
            <p class="mt-0.5 text-sm text-base-content/70">${esc(n.body)}</p>
            <p class="mt-1 text-xs text-base-content/50">${timeAgo(n.createdAt)}</p>
          </div>
        </li>`;
    }).join(''))}`
    : emptyState('bell-off', 'No notifications yet', '<p class="mx-auto mt-1 max-w-xs text-sm text-base-content/60">When someone gives you work or a reminder is due, it shows up here.</p>');
}

// ---------- Bottom sheet forms ----------
function field(label, control, hint = '') {
  return `<fieldset class="fieldset p-0"><legend class="fieldset-legend pt-0 text-sm">${label}</legend>${control}${hint ? `<p class="label">${hint}</p>` : ''}</fieldset>`;
}
function seg(name, options, value) {
  return `<div class="join w-full">${Object.entries(options).map(([k, v]) =>
    `<input class="join-item btn btn-sm flex-1" type="radio" name="${name}" value="${esc(k)}" aria-label="${esc(v)}" ${k === value ? 'checked' : ''}>`).join('')}</div>`;
}
function peopleOptions() {
  return Object.fromEntries(people().map(p => [p, p === state.me ? `${p} (me)` : p]));
}

let sheetHandlers = {};
function openSheet(title, bodyHtml, { onSave, onDelete, saveLabel = 'Save' } = {}) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = bodyHtml;
  $('#sheet-delete').hidden = !onDelete;
  $('#sheet-save').hidden = !onSave;
  $('#sheet-save').textContent = saveLabel;
  $('#sheet-cancel').textContent = onSave ? 'Cancel' : 'Close';
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
  const reminder = String(t._id ? t.reminder ?? -1 : 15);
  return `
    ${field('Task', `<input type="text" name="title" class="input w-full" required maxlength="200" value="${esc(t.title)}" placeholder="What needs doing?">`)}
    <div class="grid grid-cols-2 gap-3">
      ${field('Date', `<input type="date" name="date" class="input w-full" required value="${esc(t.date || state.date)}">`)}
      ${field('Time', `<input type="time" name="time" class="input w-full" value="${esc(t.time)}">`)}
    </div>
    ${field('Reminder', `<select name="reminder" class="select w-full">${Object.entries(LABELS.reminder)
      .sort((a, b) => a[0] - b[0]).map(([k, v]) => `<option value="${k}" ${k === reminder ? 'selected' : ''}>${v}</option>`).join('')}</select>`,
      'Reminders need a time. They go to whoever the task is for.')}
    ${field('Priority', seg('priority', LABELS.priority, t.priority || 'medium'))}
    ${t._id ? field('Status', seg('status', LABELS.task, t.status)) : ''}
    ${field('For', seg('assignee', peopleOptions(), t.assignee || state.me))}
    ${field('Project', `<select name="project" class="select w-full"><option value="">None</option>${projectOpts}</select>`)}
    ${field('Notes', `<textarea name="notes" class="textarea w-full" rows="3" maxlength="2000">${esc(t.notes)}</textarea>`)}`;
}

function newTask() {
  openSheet('New task', taskForm(), {
    saveLabel: 'Add task',
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
  openSheet('Edit task', taskForm(t), {
    onSave: async d => {
      await api('PATCH', `/api/tasks/${id}`, d);
      toast('Task saved');
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
    ${field('Project name', `<input type="text" name="name" class="input w-full" required maxlength="120" value="${esc(p.name)}">`)}
    ${field('Status', seg('status', LABELS.project, p.status || 'planning'))}
    ${field('Priority', seg('priority', LABELS.priority, p.priority || 'medium'))}
    ${field('Owner', seg('owner', peopleOptions(), p.owner || state.me))}
    <div class="grid grid-cols-2 gap-3">
      ${field('Due date', `<input type="date" name="dueDate" class="input w-full" value="${esc(p.dueDate)}">`)}
      ${field('Progress %', `<input type="number" name="progress" class="input w-full" min="0" max="100" step="5" value="${p.progress ?? 0}">`)}
    </div>
    ${field('Notes', `<textarea name="notes" class="textarea w-full" rows="3" maxlength="2000">${esc(p.notes)}</textarea>`)}`;
}

function newProject() {
  openSheet('New project', projectForm(), {
    saveLabel: 'Add project',
    onSave: async d => {
      const p = await api('POST', '/api/projects', { ...d, progress: Number(d.progress) });
      replaceProject(p);
      state.view = 'project';
      state.projectId = p._id;
      state.ptab = 'works';
      toast('Project added');
      render();
    },
  });
}

function editProject() {
  const p = state.projects.find(x => x._id === state.projectId);
  openSheet('Edit project', projectForm(p), {
    onSave: async d => {
      replaceProject(await api('PATCH', `/api/projects/${p._id}`, { ...d, progress: Number(d.progress) }));
      toast('Project saved');
      render();
    },
    onDelete: async () => {
      if (!confirm(`Delete "${p.name}" with all its works and updates?`)) throw new Error('cancelled');
      await api('DELETE', `/api/projects/${p._id}`);
      state.view = 'projects';
      toast('Project deleted');
      await refresh();
    },
  });
}

function workForm(w = {}) {
  return `
    ${field('Work item', `<input type="text" name="title" class="input w-full" required maxlength="200" value="${esc(w.title)}">`)}
    ${field('Status', seg('status', LABELS.work, w.status || 'todo'))}
    ${field('Priority', seg('priority', LABELS.priority, w.priority || 'medium'))}
    ${field('For', seg('assignee', peopleOptions(), w.assignee || state.me))}
    ${field('Due date', `<input type="date" name="dueDate" class="input w-full" value="${esc(w.dueDate)}">`)}`;
}

function newWork() {
  openSheet('New work item', workForm(), {
    saveLabel: 'Add work',
    onSave: async d => {
      replaceProject(await api('POST', `/api/projects/${state.projectId}/works`, d));
      state.ptab = 'works';
      toast('Work item added');
      render();
    },
  });
}

function editWork(wid) {
  const p = state.projects.find(x => x._id === state.projectId);
  openSheet('Edit work item', workForm(findWork(wid)), {
    onSave: async d => {
      replaceProject(await api('PATCH', `/api/projects/${p._id}/works/${wid}`, d));
      toast('Work item saved');
      render();
    },
    onDelete: async () => {
      replaceProject(await api('DELETE', `/api/projects/${p._id}/works/${wid}`));
      toast('Work item deleted');
      render();
    },
  });
}

function settingsBody() {
  const theme = localStorage.getItem('tt-theme') || '';
  let push;
  if (!state.config.vapidPublicKey) push = '<p class="text-sm text-base-content/70">Notifications are not set up on the server yet.</p>';
  else if (state.pushOn) {
    push = `<p class="flex items-center gap-2 text-sm">${icon('bell-ring', 'size-4 text-success')}On for this device</p>
      <div class="mt-2 flex gap-2">
        <button type="button" class="btn btn-soft btn-sm" data-action="test-push">${icon('send')}Send a test</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="disable-push">Turn off</button>
      </div>`;
  } else if (isIOS && !isStandalone) {
    push = '<p class="text-sm text-base-content/70">On iPhone, tap Share, then Add to Home Screen. Open the app from there to turn notifications on.</p>';
  } else {
    push = `<p class="text-sm text-base-content/70">Off for this device</p>
      <button type="button" class="btn btn-primary btn-sm mt-2 self-start" data-action="enable-push">${icon('bell')}Turn on notifications</button>`;
  }
  return `
    <div class="flex items-center gap-3">
      ${avatar(state.me, 'size-12 text-base')}
      <div><div class="font-semibold">${esc(state.me)}</div><div class="text-sm text-base-content/60">Signed in on this device</div></div>
    </div>
    ${field('Notifications', `<div class="flex flex-col">${push}</div>`)}
    ${field('Appearance', seg('theme', { '': 'System', ledger: 'Light', 'ledger-dark': 'Dark' }, theme))}
    <button type="button" class="btn btn-outline btn-error" data-action="sign-out">${icon('log-out')}Switch user</button>`;
}
function openSettings() {
  openSheet('Settings', settingsBody());
}

// ---------- Events ----------
async function setTask(id, changes) {
  await api('PATCH', `/api/tasks/${id}`, changes);
  await refresh();
}
async function setWork(wid, changes, pid = state.projectId) {
  replaceProject(await api('PATCH', `/api/projects/${pid}/works/${wid}`, changes));
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
  'new-task': newTask,
  'new-project': newProject,
  'open-project': id => { state.view = 'project'; state.projectId = id; state.ptab = 'works'; render(); window.scrollTo(0, 0); },
  'edit-project': editProject,
  'toggle-work': (wid, { pid }) => {
    const w = findWork(wid, pid);
    return setWork(wid, { status: w.status === 'done' ? 'todo' : 'done' }, pid);
  },
  'cycle-work': (wid, { pid }) => setWork(wid, { status: NEXT_STATUS[findWork(wid, pid).status] }, pid),
  'edit-work': editWork,
  'delete-update': async uid => {
    if (!confirm('Delete this update?')) return;
    replaceProject(await api('DELETE', `/api/projects/${state.projectId}/updates/${uid}`));
    render();
  },
  'open-notice': async id => {
    const n = state.notifications.find(x => x._id === id);
    if (!n.read) { n.read = true; api('POST', '/api/notifications/read', { id }).then(loadNotifications).catch(() => {}); }
    if (!openLink(n.url)) return;
    await refresh();
    window.scrollTo(0, 0);
  },
  'read-all': async () => {
    await api('POST', '/api/notifications/read');
    await loadNotifications();
    renderInbox();
  },
  'enable-push': async () => {
    await enablePush();
    if ($('#sheet').open) $('#sheet-body').innerHTML = settingsBody();
  },
  'disable-push': async () => {
    await disablePush();
    toast('Notifications are off on this device');
    $('#sheet-body').innerHTML = settingsBody();
    render();
  },
  'test-push': async () => {
    await api('POST', '/api/push/test');
    toast('Test sent. It should arrive in a few seconds.');
  },
  'dismiss-push': () => { localStorage.setItem('tt-push-dismissed', '1'); renderPushBanner(); },
  'sign-out': () => {
    if (!confirm(`Signed in as ${state.me}. Switch user?`)) return;
    closeSheet();
    return signOut();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    if (el.tagName === 'A') e.preventDefault();
    Promise.resolve(actions[el.dataset.action](el.dataset.id, el.dataset)).catch(err => { if (err.message !== 'cancelled') toastError(err); });
    return;
  }
  const t = e.target.closest('[data-who],[data-tab],[data-day],[data-date],[data-member],[data-ptab]');
  if (!t) return;
  if (t.dataset.member) return signIn(t.dataset.member);
  if (t.dataset.who) { state.who = t.dataset.who; localStorage.setItem('tt-who', state.who); renderToday(); }
  if (t.dataset.ptab) { state.ptab = t.dataset.ptab; renderProject(); }
  if (t.dataset.tab) { state.view = t.dataset.tab; render(); window.scrollTo(0, 0); }
  if (t.dataset.day) { state.date = addDays(state.date, Number(t.dataset.day)); safeRefresh(); }
  if (t.dataset.date) { state.date = t.dataset.date; safeRefresh(); }
});

$('#sort-btn').addEventListener('click', () => {
  state.sort = state.sort === 'time' ? 'priority' : 'time';
  localStorage.setItem('tt-sort', state.sort);
  renderToday();
});
$('#go-today').addEventListener('click', () => { state.date = todayISO(); safeRefresh(); });

// Progress slider: show the value live, save when released.
document.addEventListener('input', e => {
  if (e.target.dataset.action === 'progress') $('#progress-val').textContent = `${e.target.value}%`;
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.name === 'pfilter') { state.pfilter = el.value; renderProjects(); return; }
  if (el.name === 'theme') {
    if (el.value) document.documentElement.dataset.theme = el.value; else delete document.documentElement.dataset.theme;
    if (el.value) localStorage.setItem('tt-theme', el.value); else localStorage.removeItem('tt-theme');
    return;
  }
  if (el.dataset.action !== 'progress') return;
  try {
    replaceProject(await api('PATCH', `/api/projects/${state.projectId}`, { progress: Number(el.value) }));
    toast(`Progress set to ${el.value}%`);
  } catch (err) { toastError(err); }
});

// Quick-add forms on the project page.
document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form).entries());
  const isWork = form.dataset.form === 'add-work';
  try {
    replaceProject(await api('POST', `/api/projects/${state.projectId}/${isWork ? 'works' : 'updates'}`, d));
    render();
    toast(isWork ? 'Work item added' : 'Update posted');
    if (isWork) $('[data-form=add-work] input[name=title]')?.focus();
  } catch (err) { toastError(err); }
});

// Tapping the big date opens the device's date picker.
const picker = Object.assign(document.createElement('input'), { type: 'date', tabIndex: -1 });
picker.setAttribute('aria-hidden', 'true');
picker.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:50%;top:80px;width:1px;height:1px';
document.body.appendChild(picker);
$('#date-label').addEventListener('click', () => {
  picker.value = state.date;
  if (picker.showPicker) picker.showPicker(); else picker.click();
});
picker.addEventListener('change', () => { if (picker.value) { state.date = picker.value; safeRefresh(); } });

$('#fab').addEventListener('click', () => {
  if (state.view === 'today') newTask();
  else if (state.view === 'projects') newProject();
  else if (state.view === 'project') newWork();
});
$('#back-btn').addEventListener('click', () => { state.view = 'projects'; render(); });
$('#me-btn').addEventListener('click', openSettings);

$('#sheet-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!sheetHandlers.onSave) return;
  const btn = $('#sheet-save');
  btn.disabled = true;
  try { await sheetHandlers.onSave(formData()); closeSheet(); } catch (err) { toastError(err); } finally { btn.disabled = false; }
});
$('#sheet-cancel').addEventListener('click', closeSheet);
$('#sheet-delete').addEventListener('click', async () => {
  try { await sheetHandlers.onDelete(); closeSheet(); } catch (err) { if (err.message !== 'cancelled') toastError(err); }
});

// ---------- Live sync between both members ----------
// Re-fetch every few seconds while the app is visible, and right away when it comes back to the foreground.
setInterval(() => {
  // Skip while someone is typing or dragging so their input isn't wiped by a re-render.
  // In the background, only check for new notifications.
  const busy = $('#sheet').open || document.activeElement?.matches('input, textarea, select');
  if (!state.me || $('#app').hidden) return;
  if (document.hidden) loadNotifications().catch(() => {});
  else if (!busy) safeRefresh();
}, SYNC_EVERY_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.me && !$('#app').hidden) safeRefresh();
});

// ---------- Boot ----------
hydrateIcons();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // A tapped notification asks an already-open app to show the right screen.
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'open' && state.me && openLink(e.data.url)) safeRefresh();
  });
}

(async () => {
  try {
    state.config = await fetch('/api/config').then(r => r.json());
  } catch {
    state.config = null;
  }
  if (!state.config || state.config.dbError) {
    $('#boot').hidden = true;
    $('#login').hidden = false;
    const err = $('#login-error');
    err.textContent = state.config ? state.config.dbError : 'Cannot reach the server. Check your internet connection and reload.';
    err.hidden = false;
    return;
  }
  if (state.me && state.config.members.includes(state.me)) startApp();
  else showLogin();
})();
