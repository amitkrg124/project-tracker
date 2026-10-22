// Inbox notifications, web push, task reminders, and the morning summary.
const webpush = require('web-push');
const { Notification, PushSubscription, Sent, Task, Project } = require('./models');
const { MEMBERS, TIME_ZONE, DIGEST_TIME, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = require('./config');

const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const REMINDER_WINDOW_MIN = 15; // a reminder still goes out if the cron job runs up to this late
const DIGEST_WINDOW_MIN = 180;

// ---------- Formatting ----------
function fmtDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- Sending ----------
async function sendPush(sub, message) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(message), { TTL: 6 * 3600, urgency: 'high' });
  } catch (err) {
    // 404/410 mean the browser dropped the subscription; forget it.
    if (err.statusCode === 404 || err.statusCode === 410) await PushSubscription.deleteOne({ _id: sub._id });
    else console.error('Push failed:', err.statusCode || '', err.body || err.message);
  }
}

// Put a notification in each member's inbox and push it to all their devices.
async function notify(members, { by = '', kind, heading, body, url = '/' }) {
  const to = [...new Set(members)].filter(m => MEMBERS.includes(m));
  if (!to.length) return;
  const docs = await Notification.insertMany(to.map(m => ({ to: m, by, kind, heading, body, url })));
  if (!pushEnabled) return;
  const subs = await PushSubscription.find({ member: { $in: to } }).lean();
  await Promise.all(subs.map(s => {
    const n = docs.find(d => d.to === s.member);
    return sendPush(s, { id: String(n._id), title: heading, body, url });
  }));
}

async function sendTestPush(member) {
  const subs = await PushSubscription.find({ member }).lean();
  await Promise.all(subs.map(s => sendPush(s, { id: 'test', title: 'Notifications are on', body: 'You will get new work and reminders here.', url: '/' })));
  return subs.length;
}

// ---------- Assignments ----------
// Tell the assignee that someone else gave them work. "Both" tells every member except the person assigning.
function assigneesExcept(assignee, by) {
  if (!assignee) return [];
  return (assignee === 'Both' ? MEMBERS : [assignee]).filter(m => m !== by);
}

async function notifyTaskAssigned(task, by) {
  const to = assigneesExcept(task.assignee, by);
  if (!to.length) return;
  const project = task.project && await Project.findById(task.project, 'name').lean();
  const when = [fmtDate(task.date), task.time && fmtTime(task.time)].filter(Boolean).join(', ');
  await notify(to, {
    by, kind: 'task',
    heading: `${by || 'Someone'} gave you a task`,
    body: `${task.title} (${when}${project ? `, ${project.name}` : ''})`,
    url: `/#/today/${task.date}`,
  });
}

async function notifyWorkAssigned(project, work, by) {
  const to = assigneesExcept(work.assignee, by);
  if (!to.length) return;
  await notify(to, {
    by, kind: 'work',
    heading: `${by || 'Someone'} gave you work on ${project.name}`,
    body: work.title + (work.dueDate ? ` (due ${fmtDate(work.dueDate)})` : ''),
    url: `/#/project/${project._id}`,
  });
}

// ---------- Reminders ----------
// Current wall-clock date and time in the team's time zone.
function localNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
// Wall-clock date + time as minutes. Only used to compare times, so the zone doesn't matter.
const minutesOf = (date, time) => Date.parse(`${date}T${time}:00Z`) / 60000;
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Returns true the first time it is called for a key, false after that.
async function claim(key) {
  try {
    await Sent.create({ key });
    return true;
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

const forMember = m => ({ $in: [m, 'Both', ''] });

async function sendTaskReminders(today, nowMin) {
  // A reminder can fall on the day before the task (e.g. 00:15 task, 30 min before).
  const tasks = await Task.find({
    date: { $in: [addDays(today, -1), today, addDays(today, 1)] },
    time: { $ne: '' }, reminder: { $gte: 0 }, status: { $in: ['todo', 'doing'] },
  }).populate('project', 'name').lean();

  let sent = 0;
  for (const t of tasks) {
    const late = nowMin - (minutesOf(t.date, t.time) - t.reminder);
    if (late < 0 || late > REMINDER_WINDOW_MIN) continue;
    if (!await claim(`task:${t._id}:${t.date}T${t.time}:${t.reminder}`)) continue;
    const to = t.assignee && t.assignee !== 'Both' ? [t.assignee] : MEMBERS;
    await notify(to, {
      kind: 'reminder',
      heading: t.title,
      body: (t.reminder ? `Starts in ${t.reminder} min, at ${fmtTime(t.time)}` : `Starts now (${fmtTime(t.time)})`)
        + (t.project ? `. ${t.project.name}` : ''),
      url: `/#/today/${t.date}`,
    });
    sent++;
  }
  return sent;
}

async function sendDigests(today, nowMin) {
  if (!DIGEST_TIME) return 0;
  const late = nowMin - minutesOf(today, DIGEST_TIME);
  if (late < 0 || late > DIGEST_WINDOW_MIN) return 0;

  const projects = await Project.find({ status: { $ne: 'done' } }, 'works').lean();
  let sent = 0;
  for (const m of MEMBERS) {
    const tasks = await Task.countDocuments({ date: today, assignee: forMember(m), status: { $in: ['todo', 'doing'] } });
    const works = projects.flatMap(p => p.works).filter(w =>
      w.status !== 'done' && ['', 'Both', m].includes(w.assignee) && w.dueDate && w.dueDate <= today).length;
    if (!tasks && !works) continue;
    if (!await claim(`digest:${m}:${today}`)) continue;
    const parts = [tasks && plural(tasks, 'task'), works && `${plural(works, 'project work')} due`].filter(Boolean);
    await notify([m], { kind: 'digest', heading: `Good morning, ${m}`, body: `Today you have ${parts.join(' and ')}.`, url: '/#/today' });
    sent++;
  }
  return sent;
}

// Called every minute by the cron job (or by the timer when running as a normal server).
async function runReminders(now = new Date()) {
  await Sent.init(); // make sure the unique index exists before relying on it
  const { date, time } = localNow(now);
  const nowMin = minutesOf(date, time);
  return { at: `${date} ${time} ${TIME_ZONE}`, reminders: await sendTaskReminders(date, nowMin), digests: await sendDigests(date, nowMin) };
}

module.exports = { pushEnabled, notifyTaskAssigned, notifyWorkAssigned, sendTestPush, runReminders, localNow };
