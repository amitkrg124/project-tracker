const mongoose = require('mongoose');

const PRIORITIES = ['high', 'medium', 'low'];
const TASK_STATUSES = ['todo', 'doing', 'done', 'postponed'];
const PROJECT_STATUSES = ['planning', 'active', 'hold', 'done'];
const WORK_STATUSES = ['todo', 'doing', 'blocked', 'done'];
const UPDATE_TYPES = ['progress', 'issue', 'decision'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;   // YYYY-MM-DD
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm

// Daily task. Date and time are stored as plain strings so they stay in the team's local time.
const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  date: { type: String, required: true, match: DATE_RE, index: true },
  time: { type: String, default: '', validate: v => v === '' || TIME_RE.test(v) },
  priority: { type: String, enum: PRIORITIES, default: 'medium' },
  status: { type: String, enum: TASK_STATUSES, default: 'todo' },
  assignee: { type: String, default: '', maxlength: 60 },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  notes: { type: String, default: '', maxlength: 2000 },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

const workSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  status: { type: String, enum: WORK_STATUSES, default: 'todo' },
  priority: { type: String, enum: PRIORITIES, default: 'medium' },
  assignee: { type: String, default: '', maxlength: 60 },
  dueDate: { type: String, default: '', validate: v => v === '' || DATE_RE.test(v) },
}, { timestamps: true });

const updateSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  type: { type: String, enum: UPDATE_TYPES, default: 'progress' },
  by: { type: String, default: '' },
}, { timestamps: true });

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  status: { type: String, enum: PROJECT_STATUSES, default: 'planning' },
  priority: { type: String, enum: PRIORITIES, default: 'medium' },
  owner: { type: String, default: '', maxlength: 60 },
  dueDate: { type: String, default: '', validate: v => v === '' || DATE_RE.test(v) },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  notes: { type: String, default: '', maxlength: 2000 },
  works: [workSchema],
  updates: [updateSchema],
}, { timestamps: true });

module.exports = {
  Task: mongoose.model('Task', taskSchema),
  Project: mongoose.model('Project', projectSchema),
  PRIORITIES, TASK_STATUSES, PROJECT_STATUSES, WORK_STATUSES, UPDATE_TYPES,
};
