const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const { PORT, MONGODB_URI, PASSCODE, MEMBERS, TIME_ZONE, CRON_SECRET, VAPID_PUBLIC_KEY } = require('./config');
const { Task, Project, Notification, PushSubscription, PRIORITIES, TASK_STATUSES, PROJECT_STATUSES, WORK_STATUSES, UPDATE_TYPES, REMINDERS } = require('./models');
const { pushEnabled, notifyTaskAssigned, notifyWorkAssigned, sendTestPush, runReminders } = require('./notify');

const AFTER = { returnDocument: 'after', runValidators: true };

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  // The service worker and the page must always be fresh so updates reach phones quickly.
  setHeaders: (res, file) => { if (/(sw\.js|\.html)$/.test(file)) res.set('Cache-Control', 'no-cache'); },
}));

// Connect once and reuse the connection. On Vercel each serverless instance keeps it between requests.
let dbPromise = null;
function connectDb() {
  if (MONGODB_URI.includes('<db_password>')) {
    return Promise.reject(new Error('Replace <db_password> in MONGODB_URI with your real MongoDB password.'));
  }
  dbPromise ||= mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 }).catch(err => {
    dbPromise = null; // let the next request try again
    throw err;
  });
  return dbPromise;
}

// Copy only allowed fields from the request body.
function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

// Wrap async route handlers so errors reach the error middleware.
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Explain database problems in plain words so they show up on the sign-in screen.
function dbErrorMessage(err) {
  const msg = err.message || '';
  if (/<db_password>/.test(msg)) return msg;
  if (/auth/i.test(msg)) return 'Database login failed: check the username and password in MONGODB_URI.';
  if (/127.0.0.1|localhost/.test(MONGODB_URI)) return 'MONGODB_URI is not set on the server. Add it to the environment variables and redeploy.';
  if (/unescaped|Invalid scheme|connection string|URI|parse/i.test(msg)) {
    return 'MONGODB_URI is not written correctly. Paste it without quotes or spaces, and write @ inside the password as %40.';
  }
  if (/ENOTFOUND|querySrv/i.test(msg)) return 'The cluster address in MONGODB_URI is wrong. Copy it again from Atlas → Connect.';
  // Show the driver's own reason, with any credentials removed.
  return 'Could not reach the database: ' + msg.replace(/\/\/[^@/]*@/g, '//***@');
}

app.get('/api/config', wrap(async (req, res) => {
  const dbError = await connectDb().then(() => '', err => { console.error('MongoDB:', err.message); return dbErrorMessage(err); });
  res.json({
    dbError, members: MEMBERS, needsPasscode: Boolean(PASSCODE), timeZone: TIME_ZONE,
    vapidPublicKey: pushEnabled ? VAPID_PUBLIC_KEY : '',
    PRIORITIES, TASK_STATUSES, PROJECT_STATUSES, WORK_STATUSES, UPDATE_TYPES, REMINDERS,
  });
}));

app.post('/api/login', (req, res) => {
  if (!PASSCODE || req.body.passcode === PASSCODE) return res.json({ ok: true });
  res.status(401).json({ error: 'Wrong passcode' });
});

// Everything below needs the database.
app.use('/api', (req, res, next) => connectDb().then(() => next(), err => res.status(503).json({ error: dbErrorMessage(err) })));

// Sends due reminders. Call it every minute from a cron service with the CRON_SECRET.
app.get('/api/cron/reminders', wrap(async (req, res) => {
  const key = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.key;
  if (!CRON_SECRET || key !== CRON_SECRET) return res.status(401).json({ error: 'Set CRON_SECRET and send it as ?key= or a Bearer token' });
  res.json(await runReminders());
}));

// Everything below requires the shared team passcode (when one is set).
app.use('/api', (req, res, next) => {
  if (PASSCODE && req.get('x-passcode') !== PASSCODE) return res.status(401).json({ error: 'Passcode required' });
  next();
});

const member = req => {
  const m = req.get('x-member') || '';
  return MEMBERS.includes(m) ? m : '';
};

// ---------- Daily tasks ----------
const TASK_FIELDS = ['title', 'date', 'time', 'priority', 'status', 'assignee', 'project', 'notes', 'reminder'];

function taskData(body) {
  const data = pick(body, TASK_FIELDS);
  if (data.project === '') data.project = null;
  if (data.reminder !== undefined) data.reminder = Number(data.reminder);
  return data;
}

app.get('/api/tasks', wrap(async (req, res) => {
  const { date, today } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const tasks = await Task.find({ date }).populate('project', 'name').lean();
  const overdue = today
    ? await Task.find({ date: { $lt: today }, status: { $in: ['todo', 'doing'] } }).populate('project', 'name').sort({ date: 1 }).lean()
    : [];
  res.json({ tasks, overdue });
}));

app.post('/api/tasks', wrap(async (req, res) => {
  const by = member(req);
  const task = await Task.create({ ...taskData(req.body), updatedBy: by });
  await notifyTaskAssigned(task, by);
  res.status(201).json(task);
}));

app.patch('/api/tasks/:id', wrap(async (req, res) => {
  const by = member(req);
  const before = await Task.findById(req.params.id).lean();
  if (!before) return res.status(404).json({ error: 'Task not found' });
  const task = await Task.findByIdAndUpdate(req.params.id, { ...taskData(req.body), updatedBy: by }, AFTER);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.assignee !== before.assignee) await notifyTaskAssigned(task, by);
  res.json(task);
}));

app.delete('/api/tasks/:id', wrap(async (req, res) => {
  await Task.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

// ---------- Projects ----------
const PROJECT_FIELDS = ['name', 'status', 'priority', 'owner', 'dueDate', 'progress', 'notes'];
const WORK_FIELDS = ['title', 'status', 'priority', 'assignee', 'dueDate'];

app.get('/api/projects', wrap(async (req, res) => {
  res.json(await Project.find().sort({ updatedAt: -1 }).lean());
}));

app.post('/api/projects', wrap(async (req, res) => {
  res.status(201).json(await Project.create(pick(req.body, PROJECT_FIELDS)));
}));

app.patch('/api/projects/:id', wrap(async (req, res) => {
  const project = await Project.findByIdAndUpdate(req.params.id, pick(req.body, PROJECT_FIELDS), AFTER);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
}));

app.delete('/api/projects/:id', wrap(async (req, res) => {
  await Project.findByIdAndDelete(req.params.id);
  await Task.updateMany({ project: req.params.id }, { project: null });
  res.json({ ok: true });
}));

// Pending works (embedded in a project). Each change is a single atomic update.
app.post('/api/projects/:id/works', wrap(async (req, res) => {
  const project = await Project.findByIdAndUpdate(req.params.id, { $push: { works: pick(req.body, WORK_FIELDS) } }, AFTER);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  await notifyWorkAssigned(project, project.works[project.works.length - 1], member(req));
  res.status(201).json(project);
}));

app.patch('/api/projects/:id/works/:wid', wrap(async (req, res) => {
  const set = {};
  for (const [k, v] of Object.entries(pick(req.body, WORK_FIELDS))) set[`works.$.${k}`] = v;
  const filter = { _id: req.params.id, 'works._id': req.params.wid };
  const before = await Project.findOne(filter, { 'works.$': 1 }).lean();
  if (!before) return res.status(404).json({ error: 'Work item not found' });
  const project = await Project.findOneAndUpdate(filter, { $set: set }, AFTER);
  if (!project) return res.status(404).json({ error: 'Work item not found' });
  const work = project.works.id(req.params.wid);
  if (work.assignee !== before.works[0].assignee) await notifyWorkAssigned(project, work, member(req));
  res.json(project);
}));

app.delete('/api/projects/:id/works/:wid', wrap(async (req, res) => {
  res.json(await Project.findByIdAndUpdate(req.params.id, { $pull: { works: { _id: req.params.wid } } }, { returnDocument: 'after' }));
}));

// Project updates log (newest first).
app.post('/api/projects/:id/updates', wrap(async (req, res) => {
  const update = { ...pick(req.body, ['text', 'type']), by: member(req) };
  const project = await Project.findByIdAndUpdate(req.params.id, { $push: { updates: { $each: [update], $position: 0 } } }, AFTER);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.status(201).json(project);
}));

app.delete('/api/projects/:id/updates/:uid', wrap(async (req, res) => {
  res.json(await Project.findByIdAndUpdate(req.params.id, { $pull: { updates: { _id: req.params.uid } } }, { returnDocument: 'after' }));
}));

// ---------- Notifications (for the signed-in member) ----------
app.get('/api/notifications', wrap(async (req, res) => {
  res.json(await Notification.find({ to: member(req) }).sort({ createdAt: -1 }).limit(50).lean());
}));

// Marks one notification ({ id }) or all of them as read.
app.post('/api/notifications/read', wrap(async (req, res) => {
  const filter = { to: member(req), read: false };
  if (req.body.id) filter._id = req.body.id;
  await Notification.updateMany(filter, { read: true });
  res.json({ ok: true });
}));

// ---------- Push subscriptions (one per device) ----------
app.post('/api/push/subscribe', wrap(async (req, res) => {
  const m = member(req);
  const { endpoint, keys } = req.body;
  if (!m) return res.status(400).json({ error: 'Sign in as a team member first' });
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid push subscription' });
  }
  // A device belongs to whoever signed in on it last.
  await PushSubscription.findOneAndUpdate({ endpoint }, { member: m, keys: { p256dh: keys.p256dh, auth: keys.auth } }, { upsert: true });
  res.json({ ok: true });
}));

app.post('/api/push/unsubscribe', wrap(async (req, res) => {
  if (req.body.endpoint) await PushSubscription.deleteOne({ endpoint: req.body.endpoint });
  res.json({ ok: true });
}));

app.post('/api/push/test', wrap(async (req, res) => {
  const devices = await sendTestPush(member(req));
  if (!devices) return res.status(400).json({ error: 'Notifications are not turned on for this member yet' });
  res.json({ ok: true, devices });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  const status = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 400 ? err.message : 'Server error' });
});

// Run as a normal server locally (npm start). On Vercel the exported app is used instead.
if (require.main === module) {
  connectDb()
    .then(() => {
      app.listen(PORT, () => console.log(`Team Tracker running at http://localhost:${PORT}`));
      // A long-running server checks reminders itself; on Vercel a cron job calls /api/cron/reminders.
      setInterval(() => runReminders().catch(err => console.error('Reminders:', err.message)), 60 * 1000);
    })
    .catch(err => {
      console.error('Could not connect to MongoDB:', err.message);
      process.exit(1);
    });
}

module.exports = app;
