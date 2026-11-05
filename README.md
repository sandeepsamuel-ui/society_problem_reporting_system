# CivicPulse: AI-powered urban issue reporting

Citizens photograph a civic problem (pothole, garbage, water leak, broken streetlight…), optionally describe it by voice in **Telugu or English**, and the app routes it to the correct municipal department with an AI severity score. Department admins see a prioritized list, a heatmap and a log of every AI result, and update the status.

The whole site is available in **English and Telugu** (switch at the top of every page), and a **help assistant** (💬 bottom-right) answers questions about using the app in both languages.

## Folder structure

```
db/         schema.sql (all tables), database.js (SQLite connection + migrations)
            civicpulse.db is created on first run and holds ALL data
backend/    Express API server
  server.js            entry point, also serves the frontend
  routes/auth.js       citizen & department-admin register/login (bcrypt + JWT)
  routes/citizen.js    photo analysis, submit issue, my history
  routes/admin.js      department issues, details, status update, heatmap, stats, AI log
  routes/chat.js       help assistant API
  i18n.js              server messages in English and Telugu
  ai/chatbot.js        help assistant: bilingual knowledge base (+ Gemini when a key is set)
  ai/localVision.js    local CLIP model: offline image classification + image fingerprints
  ai/llm.js            cloud AI: Google Gemini (optional key)
  ai/classifier.js     AI feature 1: image classification + department routing + title/description
  ai/duplicates.js     AI feature 2: duplicate detection & merging
  ai/severity.js       AI feature 4: 1-10 severity score
  ai/areaPriority.js   AI feature 3: red / orange / yellow area priority (citizens within 1 km)
  ai/verifier.js       completion photo check: before/after AI comparison + GPS
  services/upload.js   photo upload handling
  services/geo.js      distance, nearby hospitals/fire stations (OpenStreetMap), reverse geocoding
  uploads/             uploaded photos
  models/              local AI model, downloaded automatically on first run (~150 MB)
.vscode/    VS Code setup: F5 launch, Live Server settings, recommended extension
package.json  top-level shortcuts: npm install / npm start from the CivicPulse folder
frontend/   index.html (login/register), citizen.html, admin.html, css/
  js/config.js         backend address used when the pages are served by Live Server
  js/i18n.js           all English + Telugu text for the pages
  js/chatbot.js        floating help assistant widget
```

## Languages and help assistant

- **English / తెలుగు switch** at the top of every page. The choice is remembered, and server messages (errors, confirmations) follow it.
- **Help assistant** (💬 bottom-right on every page) answers questions such as "How does the app work?", "How do I record a complaint?", "ఫిర్యాదు ఎలా చేయాలి?", "What is the severity score?". Questions can be typed or spoken.
  - Logged-in citizens can ask "What is the status of my complaint?" and get their latest tickets. Admins get their department's counts.
  - Without a key it uses a built-in bilingual knowledge base. With `GEMINI_API_KEY` set, Gemini answers free-form questions using the same app knowledge.
  - For emergencies it points to 112 / 108 / 101 / 100.

## Run it in VS Code

Requires **Node.js 22.13+** (nodejs.org, LTS) and an internet connection on the first run, to download the npm packages and the AI model.
Unzip, then in VS Code use **File → Open Folder…** and open the `CivicPulse` folder (the one containing `backend`, `frontend`, `db`).

### Option A: terminal (simplest)
Open **Terminal → New Terminal** and run, in the `CivicPulse` folder:

```bash
npm install
npm start
```

Then **Ctrl+click** `http://localhost:5000` in the terminal. Next time, `npm start` is enough.
(Running `npm install` and `npm start` inside the `backend` folder also works.)

### Option B: press F5
Open the **Run and Debug** panel, choose **▶ Start CivicPulse** and press **F5**. It installs packages, starts the server, and opens the browser automatically.

### Option C: Live Server extension
1. Start the backend first with Option A or B. Live Server cannot run the Node.js API by itself.
2. Install the **Live Server** extension (VS Code suggests it when you open the folder).
3. Click **Go Live** in the bottom status bar, or right-click `frontend/index.html` → **Open with Live Server**.
4. The site opens at `http://127.0.0.1:5500` and talks to the backend on `http://localhost:5000`.
   The folder's `.vscode/settings.json` already sets Live Server to serve `frontend` and to ignore database and photo changes, so the page doesn't reload by itself.

If the page says it **cannot reach the CivicPulse server**, the backend isn't running: start it with `npm start`.

Use Chrome or Edge. The camera, GPS and Telugu speech recognition need one of these browsers, and they work on `localhost` / `127.0.0.1`.

**Port 5000 busy?** Stop the other running copy (Ctrl+C in its terminal), or put `PORT=5001` in `backend/.env`. If you use Live Server, also change the port in `frontend/js/config.js`.

The first start downloads the local AI model (~150 MB, about 1 minute). After that it loads in a few seconds and works offline.

### Optional: better AI with Google Gemini

Works with **no API key**: the local CLIP model classifies photos, and the report text comes from templates.
With a key, the cloud model writes a real description of the photo and translates Telugu voice notes.

1. Get a free Gemini key at https://aistudio.google.com/apikey.
2. In `backend/`, copy `.env.example` to `.env` and paste it as `GEMINI_API_KEY=...`.
3. Restart with `npm start`. The log shows `Cloud AI: Google Gemini (...)`.

If a cloud call fails, the app automatically falls back to the local model.

## Where results are stored

Everything is saved in the SQLite database **`db/civicpulse.db`** and survives server restarts:

| Table | What it holds |
|-------|---------------|
| `citizens`, `admins` | accounts (passwords hashed with bcrypt) |
| `issues` | one row per real problem: department, AI severity, priority, nearby facilities, image fingerprint |
| `reports` | every citizen submission, incl. merged duplicates and the reason they were merged |
| `ai_analyses` | **every AI result**: provider, category, confidence, title, description, severity, local model scores |
| `status_history` | every status change by admins |

Admins can view the stored AI results in the dashboard's **🤖 AI log** tab. To browse the raw database, open `db/civicpulse.db` with "DB Browser for SQLite".

## The 4 AI features

| # | Feature | How it works |
|---|---------|--------------|
| 1 | **Automated image classification** | Order: Google Gemini (if a key is set) → local CLIP model. The photo is classified into 15 problem types and mapped to a department (Roads, Garbage, Water, Electricity, Drainage). If the photo is unclear, a keyword in the Telugu/English voice note decides. |
| 2 | **Duplicate prevention** | Open issues of the same department within 250 m are compared. Gemini compares the two photos; without a Gemini key, the local model's image fingerprints are compared (≥ 85% similar, or ≥ 75% if the same category within 60 m). Duplicates are merged and the citizen count goes up. |
| 3 | **Intelligent prioritization** | **Area colour:** the number of different citizens who reported problems for the same department within **1 km** gives 🔴 **Red** (3 or more), 🟠 **Orange** (2) or 🟡 **Yellow** (1). Red issues are listed first and coloured on the map. The severity score also rises with the number of citizen reports and with critical public places within 1 km (OpenStreetMap: hospital or fire station +3, clinic/police/school +1). |
| 4 | **Severity score 1–10** | `final = AI visual severity + report boost + facility boost`, capped at 10 → Low / Medium / High / Critical. The breakdown is shown to admins. |

## Marking an issue as done: AI repair verification

An admin closes an issue by uploading a **completion photo** from the site (issue details → "Mark as done with a completion photo"). The browser sends the admin's GPS location with it.

| Check | Rule |
|-------|------|
| 📍 GPS | Completion photo taken within **150 m** of the reported location (`RESOLVE_RADIUS_M`) |
| 🖼️ Relevant photo | Not a selfie, room or document |
| 🔁 Same place | Before and after photos show the same scene (local model: similarity ≥ 50%) |
| ✅ Problem fixed | The problem in the citizen's photo is gone (local model: "repaired" score up by ≥ 20 points, problem score ≤ 75%) |

Only when **all four pass** is the issue marked **Resolved**. The citizen then sees before/after photos in "My reports". Every attempt, passed or failed, is saved in the `repair_checks` table and shown in the issue details. With `GEMINI_API_KEY` set, Gemini compares the two photos; otherwise the local model does.

Settings in `backend/.env`: `RESOLVE_RADIUS_M=150`, `AREA_RADIUS_M=1000`, `AREA_RED=3`, `AREA_ORANGE=2`.
