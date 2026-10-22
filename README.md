# Team Tracker

A mobile-first web app for a 2-person team (Amit and Ashish). Install it on both phones from the browser.

- **Today:** daily tasks with a time, priority, status, and who they're for. Tasks are grouped into Morning, Afternoon, Evening, and Anytime, or sorted by priority. A week strip at the top lets you jump between days.
  - **Overdue:** unfinished tasks from earlier days, with a one-tap **Move to today** button.
  - **Project work:** unfinished work items from every project that isn't done yet also show on Today, so nothing assigned inside a project gets missed.
- **Projects:** status, priority, owner, due date, and progress. Each project has a list of **works** (a checklist, each with an assignee and due date) and **updates** (progress, issues, and decisions, with who posted them).
- **Notifications:** when Amit gives Ashish a task or project work (or the other way round), the other person gets a push notification on their phone, even when the app is closed. Assigning to **Both** notifies the other member. Everything also lands in the **Inbox** tab.
- **Reminders:** give any timed task a reminder (at the start time, or 5, 15, 30, or 60 minutes before). Every morning at 09:00 each member also gets a summary of their tasks and project work due that day.

Both members see each other's changes automatically: the app re-syncs every 15 seconds and whenever you reopen it. The dot at the top shows the sync state: green synced, amber saving, red offline. Light and dark mode follow the phone's setting, or can be set in **Settings** (tap your initials).

---

## 1. Get a MongoDB database (free, 5 minutes)

For both phones to share data, use a cloud database:

1. Sign up at **https://www.mongodb.com/atlas**, then create a **free (M0) cluster**.
2. **Database Access** → add a user with a password.
3. **Network Access** → add `0.0.0.0/0` (allow from anywhere), or your server's IP.
4. **Connect → Drivers** → copy the connection string. It looks like this:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/team-tracker`

## 2. Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd team-tracker
npm install
cp .env.example .env      # then open .env and fill it in
npm run vapid             # prints a key pair for push notifications; paste both into .env
npm start
```

Open **http://localhost:3000**. When it runs with `npm start`, the server checks reminders by itself every minute.

`.env` settings:

| Setting | What it does |
|---|---|
| `MONGODB_URI` | Your MongoDB connection string |
| `MEMBERS` | The two names, comma-separated: `Amit,Ashish` |
| `APP_PASSCODE` | A shared team passcode that stops strangers getting in. **Always set this when the app is online.** |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push notification keys from `npm run vapid`. Keep the private key secret. If you change them, both phones must turn notifications on again. |
| `VAPID_SUBJECT` | A contact address for the push services, e.g. `mailto:you@gmail.com` |
| `CRON_SECRET` | Any long random string. The reminder cron job must send it (see step 3). |
| `TIME_ZONE` | Time zone for task times and reminders. Defaults to `Asia/Kolkata`. |
| `DIGEST_TIME` | Time of the morning summary, e.g. `09:00`. Leave empty to turn it off. |
| `PORT` | Defaults to 3000 |

**Testing on your phone over the same Wi-Fi:** find your PC's IP address (run `ipconfig` and look for the IPv4 Address), then open `http://192.168.x.x:3000` on the phone. Push notifications need HTTPS, so they only work once the app is online (step 3), or on `localhost`.

## 3. Put it online so you can use it from anywhere (free)

### Option A: Vercel (https://vercel.com)
1. Sign in to Vercel with GitHub → **Add New → Project** → import this repository.
2. Leave **Framework Preset** on **Other**, and leave the build settings empty.
3. Under **Environment Variables**, add `MONGODB_URI`, `MEMBERS`, `APP_PASSCODE`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, and `TIME_ZONE`.
4. Click **Deploy**, then open the `.vercel.app` URL on both phones.
5. In MongoDB Atlas → **Network Access**, allow `0.0.0.0/0`. Vercel's IP addresses change all the time, so this is required.
6. **Turn on reminders.** Vercel's free plan only runs its own cron jobs once a day, which is too slow for reminders, so use a free external cron service:
   1. Sign up at **https://cron-job.org** (free).
   2. **Create cronjob** → URL: `https://YOUR-APP.vercel.app/api/cron/reminders?key=YOUR_CRON_SECRET`
   3. Schedule: **every minute**. Save.
   4. Run it once from cron-job.org and check that the response looks like `{"at":"…","reminders":0,"digests":0}`.

Every time you push to GitHub, Vercel redeploys automatically.

### Option B: Render (https://render.com)
1. Push this folder to a GitHub repository. `.env` is git-ignored, so your secrets are not uploaded.
2. On Render, create a **New → Web Service** from that repository.
3. Build command: `npm install`. Start command: `npm start`.
4. Under **Environment**, add the same variables as for Vercel.
5. Open the URL Render gives you on both phones.
6. Render's free plan puts the app to sleep when nobody uses it, so set up the same cron-job.org job (step A6). It also keeps the app awake.

## 4. Install it and turn on notifications

- **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**. Open it, then tap **Turn on notifications** on the Today screen.
- **iPhone (Safari, iOS 16.4 or newer):** Share → **Add to Home Screen**. Notifications only work from the installed app, so open it from the Home Screen icon, then tap **Turn on notifications**.

Each phone needs to turn notifications on once. To check they work: tap your initials (top right) → **Send a test**.

---

## How to use it

| To… | Do this |
|---|---|
| Add a task, project, or work item | Tap the big **+** button. It adds whatever fits the screen you're on. |
| Mark something done | Tap the **circle** on the left |
| Change status | Tap the **status pill** (To do → Doing → Done) |
| Edit or delete | Tap the task's title |
| See another day | Tap a day in the week strip, use **‹ ›** for other weeks, or tap the big date to pick one |
| Get a reminder | Give the task a time, then pick a **Reminder** |
| See only one person's tasks | Tap **Amit** or **Ashish** above the list |
| Update project progress | Open the project and drag the **Progress** slider |
| Post a project update | Open the project → **Updates** → write it → **Post update** |
| See who gave you work | Open the **Inbox** tab. Tap a notification to open the task or project. |
| Change theme or switch user | Tap your initials (top right) |

## Files

```
server.js          Express API + MongoDB connection
models.js          Database schemas (Task, Project with works & updates, Notification, PushSubscription)
notify.js          Inbox notifications, web push, task reminders, morning summary
config.js          Settings read from environment variables
public/            The app (HTML + plain JavaScript, service worker, icons)
public/app.css     Built stylesheet (do not edit; generated from src/app.css)
src/app.css        Tailwind CSS + daisyUI theme source
scripts/           Builds public/icons.js from Lucide icons
.env.example       Settings template
```

### Changing the look

The UI uses **Tailwind CSS 4** and **daisyUI 5**, with icons from **Lucide**. The built files (`public/app.css`, `public/icons.js`) are committed, so deploying needs no build step. After changing classes in `public/app.js` / `public/index.html`, or the theme in `src/app.css`, rebuild and commit:

```bash
npm run build:ui     # icons + CSS
npm run dev:css      # or: rebuild CSS automatically while you edit
```
