require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const { Task, Project, PRIORITIES, TASK_STATUSES, PROJECT_STATUSES, WORK_STATUSES, UPDATE_TYPES } = require('./models');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/team-tracker';
const PASSCODE = process.env.APP_PASSCODE || '';
const MEMBERS = (process.env.MEMBERS || 'Member A,Member B').split(',').map(s => s.trim()).filter(Boolean);

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Copy only allowed fields from the request body.
function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

// Wrap async route handlers so errors reach the error middleware.
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

app.get('/api/config', (req, res) => {
  res.json({ members: MEMBERS, needsPasscode: Boolean(PASSCODE), PRIORITIES, TASK_STATUSES, PROJECT_STATUSES, WORK_STATUSES, UPDATE_TYPES });
});

app.post('/api/login', (req, res) => {
  if (!PASSCODE || req.body.passcode === PASSCODE) return res.json({ ok: true });
  res.status(401).json({ error: 'Wrong passcode' });
});

// Everything below requires the shared team passcode (when one is set).
app.use('/api', (req, res, next) => {
  if (PASSCODE && req.get('x-passcode') !== PASSCODE) return res.status(401).json({ error: 'Passcode required' });
  next();
});

// ---------- Daily tasks ----------
const TASK_FIELDS = ['title', 'date', 'time', 'priority', 'status', 'assignee', 'project', 'notes'];

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
  const task = await Task.create({ ...pick(req.body, TASK_FIELDS), updatedBy: req.get('x-member') });
  res.status(201).json(task);
}));

app.patch('/api/tasks/:id', wrap(async (req, res) => {
  const data = pick(req.body, TASK_FIELDS);
  if (data.project === '') data.project = null;
  const task = await Task.findByIdAndUpdate(req.params.id, { ...data, updatedBy: req.get('x-member') }, { new: true, runValidators: true });
  if (!task) return res.status(404).json({ error: 'Task not found' });
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
  const project = await Project.findByIdAndUpdate(req.params.id, pick(req.body, PROJECT_FIELDS), { new: true, runValidators: true });
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
  const project = await Project.findByIdAndUpdate(req.params.id, { $push: { works: pick(req.body, WORK_FIELDS) } }, { new: true, runValidators: true });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.status(201).json(project);
}));

app.patch('/api/projects/:id/works/:wid', wrap(async (req, res) => {
  const set = {};
  for (const [k, v] of Object.entries(pick(req.body, WORK_FIELDS))) set[`works.$.${k}`] = v;
  const project = await Project.findOneAndUpdate({ _id: req.params.id, 'works._id': req.params.wid }, { $set: set }, { new: true, runValidators: true });
  if (!project) return res.status(404).json({ error: 'Work item not found' });
  res.json(project);
}));

app.delete('/api/projects/:id/works/:wid', wrap(async (req, res) => {
  res.json(await Project.findByIdAndUpdate(req.params.id, { $pull: { works: { _id: req.params.wid } } }, { new: true }));
}));

// Project updates log (newest first).
app.post('/api/projects/:id/updates', wrap(async (req, res) => {
  const update = { ...pick(req.body, ['text', 'type']), by: req.get('x-member') };
  const project = await Project.findByIdAndUpdate(req.params.id, { $push: { updates: { $each: [update], $position: 0 } } }, { new: true, runValidators: true });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.status(201).json(project);
}));

app.delete('/api/projects/:id/updates/:uid', wrap(async (req, res) => {
  res.json(await Project.findByIdAndUpdate(req.params.id, { $pull: { updates: { _id: req.params.uid } } }, { new: true }));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  const status = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 400 ? err.message : 'Server error' });
});

if (MONGODB_URI.includes('<db_password>')) {
  console.error('Open the .env file and replace <db_password> in MONGODB_URI with your real MongoDB password.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log(`Team Tracker running at http://localhost:${PORT}`)))
  .catch(err => {
    console.error('Could not connect to MongoDB:', err.message);
    process.exit(1);
  });
