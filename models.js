const mongoose = require('mongoose');

const PRIORITIES = ['high', 'medium', 'low'];
const TASK_STATUSES = ['todo', 'doing', 'done', 'postponed'];
const PROJECT_STATUSES = ['planning', 'active', 'hold', 'done'];
const WORK_STATUSES = ['todo', 'doing', 'blocked', 'done'];
const UPDATE_TYPES = ['progress', 'issue', 'decision'];
const REMINDERS = [-1, 0, 5, 15, 30, 60]; // minutes before the task time; -1 = no reminder

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
  reminder: { type: Number, enum: REMINDERS, default: -1 },
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

// Message in a member's inbox (also sent as a push notification). Removed automatically after 30 days.
const notificationSchema = new mongoose.Schema({
  to: { type: String, required: true, index: true },
  by: { type: String, default: '' },
  kind: { type: String, enum: ['task', 'work', 'reminder', 'digest'], required: true },
  heading: { type: String, default: '' },
  body: { type: String, default: '' },
  url: { type: String, default: '/' }, // where tapping it leads, e.g. /#/project/<id>
  read: { type: Boolean, default: false },
}, { timestamps: true });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

// A device (browser) that a member turned push notifications on for.
const pushSubscriptionSchema = new mongoose.Schema({
  member: { type: String, required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
}, { timestamps: true });

// Remembers which reminders were already sent, so each goes out once even if the cron job runs twice.
const sentSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: 3 * 24 * 3600 },
});

module.exports = {
  Task: mongoose.model('Task', taskSchema),
  Project: mongoose.model('Project', projectSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  PushSubscription: mongoose.model('PushSubscription', pushSubscriptionSchema),
  Sent: mongoose.model('Sent', sentSchema),
  PRIORITIES, TASK_STATUSES, PROJECT_STATUSES, WORK_STATUSES, UPDATE_TYPES, REMINDERS,
};
