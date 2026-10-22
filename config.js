// All settings come from environment variables (see .env.example).
require('dotenv').config({ quiet: true });

const list = s => s.split(',').map(x => x.trim()).filter(Boolean);

module.exports = {
  PORT: process.env.PORT || 3000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/team-tracker',
  PASSCODE: process.env.APP_PASSCODE || '',
  MEMBERS: list(process.env.MEMBERS || 'Amit,Ashish'),
  // Task dates and times are wall-clock times in this time zone. Reminders are worked out in it.
  TIME_ZONE: process.env.TIME_ZONE || 'Asia/Kolkata',
  // Time of the morning summary (HH:mm). Leave empty to turn it off.
  DIGEST_TIME: process.env.DIGEST_TIME ?? '09:00',
  // Secret that the reminder cron job must send.
  CRON_SECRET: process.env.CRON_SECRET || '',
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:team-tracker@example.com',
};
