# ✅ Team Tracker

A simple, mobile-first web app for a 2-person team. It tracks:

- **☀️ Today:** daily tasks with a time, priority (🔴 / 🟡 / 🟢), status, and who is doing them. Tasks are grouped into Morning / Afternoon / Evening, or by priority. Unfinished tasks from earlier days show up under **⚠️ Overdue**, with a one-tap **→ Today** button.
- **📁 Projects:** each project has a status, priority, owner, due date, and a progress bar.
  - **📌 Pending works:** a checklist of work items inside each project.
  - **📝 Updates:** a running log of ✅ progress, ⚠️ issues, and 💡 decisions, showing who posted each one and when.

All data is saved in **MongoDB**. Both members see each other's changes automatically: the app re-syncs every 15 seconds and again whenever you reopen it. The small dot at the top shows the sync state: 🟢 synced, 🟠 saving, 🔴 offline.

---

## 1. Get a MongoDB database (free, 5 minutes)

For both phones to share data, use a cloud database:

1. Sign up at **https://www.mongodb.com/atlas**, then create a **free (M0) cluster**.
2. **Database Access** → add a user with a password.
3. **Network Access** → add `0.0.0.0/0` (allow from anywhere), or your server's IP.
4. **Connect → Drivers** → copy the connection string. It looks like this:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/team-tracker`

## 2. Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
cd team-tracker
npm install
cp .env.example .env      # then open .env and fill it in
npm start
```

Open **http://localhost:3000**.

`.env` settings:

| Setting | What it does |
|---|---|
| `MONGODB_URI` | Your MongoDB connection string |
| `MEMBERS` | The two names, comma-separated, e.g. `Ali,Sara` |
| `APP_PASSCODE` | A shared team passcode that stops strangers getting in. **Always set this when the app is online.** |
| `PORT` | Defaults to 3000 |

**Testing on your phone over the same Wi-Fi:** find your PC's IP address (run `ipconfig` and look for the IPv4 Address), then open `http://192.168.x.x:3000` on the phone. If it doesn't load, allow Node.js through Windows Firewall.

## 3. Put it online so you can use it from anywhere (free)

### Option A: Vercel (https://vercel.com)
1. Sign in to Vercel with GitHub → **Add New → Project** → import this repository.
2. Leave **Framework Preset** on **Other**, and leave the build settings empty.
3. Under **Environment Variables**, add `MONGODB_URI`, `MEMBERS`, and `APP_PASSCODE`.
4. Click **Deploy**, then open the `.vercel.app` URL on both phones.
5. In MongoDB Atlas → **Network Access**, allow `0.0.0.0/0`. Vercel's IP addresses change all the time, so this is required.

Every time you push to GitHub, Vercel redeploys automatically.

### Option B: Render (https://render.com)
1. Push this folder to a GitHub repository. `.env` is git-ignored, so your secrets are not uploaded.
2. On Render, create a **New → Web Service** from that repository.
3. Build command: `npm install`. Start command: `npm start`.
4. Under **Environment**, add `MONGODB_URI`, `MEMBERS`, and `APP_PASSCODE`.
5. Open the URL Render gives you on both phones.

## 4. Add it to your home screen

- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**

It then opens full-screen like a normal app.

---

## How to use it

| To… | Do this |
|---|---|
| Add a task / project / work item | Tap the big **+** button. It adds whatever fits the screen you're on. |
| Mark something done | Tap the **circle** on the left |
| Change status | Tap the **status pill** (To Do → Doing → Done) |
| Edit or delete | Tap the task's title |
| See another day | Use **‹ ›**, or tap the date to pick one |
| See only your tasks | Tap **🙋 Me** |
| Update project progress | Open the project and drag the **📈 slider** |
| Post a project update | Open the project → **Updates** → pick a type → type → **Post** |
| Switch user | Tap your initial (top right) |

## Files

```
server.js        Express API + MongoDB connection
models.js        Database schemas (Task, Project with embedded works & updates)
public/          The app UI (HTML/CSS/JS, no build step)
.env.example     Settings template
```
