# Clinicare — Clinic Appointment, Patient & Emergency Management System

A practical digital solution that reduces manual appointment management and helps
small healthcare facilities coordinate **appointments, ambulance requests, blood
availability, and basic patient records** in one place.

This is an **administrative and coordination tool only**. It does not provide
medical diagnosis, treatment recommendations, or any medical decision-making.

## Features

- **Patient management** — add, search, and remove basic patient records
- **Appointment scheduling** — book, view, complete, or cancel appointments
- **Emergency request management** — log and track ambulance/emergency requests
- **Ambulance availability** — track vehicle status and coverage area
- **Blood bank** — search blood availability by group across multiple banks
- **Hospital/clinic directory** — searchable list of nearby facilities
- **Dashboard** — live stats: today's appointments, pending emergencies, available
  ambulances, total blood stock by group

## Tech stack

- **Backend:** Node.js + Express, REST API
- **Frontend:** Vanilla HTML/CSS/JavaScript (no build step required)
- **Storage:** MongoDB Atlas when `MONGODB_URI` is set (recommended); falls
  back automatically to a local JSON file (`data/db.json`) when it isn't, so
  the app still runs with zero setup for quick local testing
- **Deployment:** Docker + Google Cloud Run ready, also deployable to
  Render or Vercel (see below)

## Connect MongoDB

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. In Atlas, go to your cluster → **Connect** → **Drivers**, copy the
   connection string, and paste it into `.env` as `MONGODB_URI`, replacing
   `<db_username>` and `<db_password>` with your **database user's**
   credentials (Database Access → your user), not your Atlas login.
3. In Atlas, go to **Network Access** and add your current IP (or, for
   quick testing / deploying to platforms with rotating IPs like Render or
   Vercel, allow access from anywhere: `0.0.0.0/0`).
4. Run `npm install` then `npm start`. The terminal will print which
   storage backend is active:
   ```
   Storage backend: MongoDB Atlas
   ```
5. The database and collection are created automatically on first run, and
   seeded with the same demo data as the file-based fallback.

**`.env` is git-ignored on purpose — never commit real database credentials.**
When deploying (Render, Vercel, Cloud Run, etc.), set `MONGODB_URI` as an
environment variable / secret in that platform's dashboard instead of
putting it in a file that gets pushed to GitHub.

## Project structure

```
clinic-system/
├── server/
│   ├── server.js       # Express app + all API routes
│   └── db.js            # JSON file storage layer + seed data
├── public/
│   ├── index.html       # Single-page app shell
│   ├── css/style.css
│   └── js/app.js        # Frontend logic (fetch calls, rendering)
├── data/
│   └── db.json          # Auto-created on first run
├── package.json
├── Dockerfile
└── README.md
```

## Run locally (in VS Code)

1. Open this folder in VS Code.
2. Open a terminal and install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open **http://localhost:8080** in your browser.

The database file (`data/db.json`) is created automatically with sample
patients, appointments, ambulances, blood banks, and hospitals the first time
you run the app. Delete that file at any point to reset to fresh seed data.

## Deploy to Google Cloud Run

```bash
# Build and submit the container image
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/clinicare

# Deploy to Cloud Run
gcloud run deploy clinicare \
  --image gcr.io/YOUR_PROJECT_ID/clinicare \
  --platform managed \
  --region YOUR_REGION \
  --allow-unauthenticated
```

Cloud Run sets the `PORT` environment variable automatically; the server
already reads `process.env.PORT`.

## Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: Clinicare management system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## API overview

| Method | Endpoint                       | Description                          |
|--------|---------------------------------|---------------------------------------|
| GET    | `/api/stats`                   | Dashboard statistics                  |
| GET/POST | `/api/patients`              | List / add patients                   |
| PUT/DELETE | `/api/patients/:id`        | Update / remove a patient             |
| GET/POST | `/api/appointments`          | List / book appointments              |
| PUT/DELETE | `/api/appointments/:id`    | Update / cancel an appointment        |
| GET/POST | `/api/emergency`             | List / submit emergency requests      |
| PUT    | `/api/emergency/:id`           | Update request status                 |
| GET/POST | `/api/ambulances`            | List / add ambulances                 |
| PUT    | `/api/ambulances/:id`          | Update ambulance status               |
| GET    | `/api/blood-banks`             | List all blood banks                  |
| GET    | `/api/blood-banks/search?group=O+` | Search banks with stock of a group |
| PUT    | `/api/blood-banks/:id`         | Update a bank's stock                 |
| GET/POST | `/api/hospitals`              | List / add hospitals & clinics      |

## Notes

- No medical diagnosis, triage advice, or treatment logic is included by
  design, in line with the challenge scope.
- Swap the JSON file store for PostgreSQL/SQLite later by replacing
  `server/db.js` — the route handlers in `server.js` are storage-agnostic.
