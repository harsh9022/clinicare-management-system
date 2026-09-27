// Load variables from a local .env file (MONGODB_URI, etc.) when present.
// Harmless in production — platforms like Render/Vercel inject real
// environment variables directly and simply won't have a .env file to load.
require("dotenv").config();

const express = require("express");
const path = require("path");
const { readDb, writeDb, nextId, usingMongo } = require("./db");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Catch malformed JSON bodies (e.g. a stray comma) with a clean 400 instead
// of Express's default HTML error page.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Malformed request body" });
  }
  next(err);
});

// ---------- Helpers ----------
function sendList(res, list) {
  res.json({ success: true, data: list });
}
function sendItem(res, item, status = 200) {
  if (!item) return res.status(404).json({ success: false, message: "Not found" });
  res.status(status).json({ success: true, data: item });
}

const PHONE_RE = /^[0-9+\-\s]{7,15}$/;
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];

function validatePhone(phone) {
  return typeof phone === "string" && PHONE_RE.test(phone.trim());
}

// Wrap every route handler (sync or async) so a thrown/rejected error
// becomes a clean 500 JSON response instead of crashing the process or
// hanging the request — important now that every handler talks to a
// database over the network and can fail or time out.
function safe(handler) {
  return (req, res) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((err) => {
        console.error(err);
        res.status(500).json({ success: false, message: "Something went wrong on the server." });
      });
  };
}

// ---------- Dashboard / Stats ----------
app.get("/api/stats", safe(async (req, res) => {
  const db = await readDb();
  const today = new Date().toISOString().slice(0, 10);

  const appointmentsToday = db.appointments.filter((a) => a.date === today).length;
  const pendingEmergencies = db.emergencyRequests.filter((e) => e.status === "Pending").length;
  const availableAmbulances = db.ambulances.filter((a) => a.status === "Available").length;

  const bloodTotals = {};
  db.bloodBanks.forEach((bank) => {
    Object.entries(bank.stock).forEach(([group, units]) => {
      bloodTotals[group] = (bloodTotals[group] || 0) + units;
    });
  });

  res.json({
    success: true,
    data: {
      appointmentsToday,
      totalAppointments: db.appointments.length,
      pendingEmergencies,
      totalEmergencies: db.emergencyRequests.length,
      availableAmbulances,
      totalAmbulances: db.ambulances.length,
      totalPatients: db.patients.length,
      bloodTotals,
      storage: usingMongo ? "mongodb" : "file"
    }
  });
}));

// ---------- Patients ----------
app.get("/api/patients", safe(async (req, res) => {
  const db = await readDb();
  const q = (req.query.q || "").toLowerCase();
  const results = q
    ? db.patients.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
    : db.patients;
  sendList(res, results);
}));

app.post("/api/patients", safe(async (req, res) => {
  const db = await readDb();
  const { name, age, gender, phone, bloodGroup, address } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ success: false, message: "Name is required" });
  if (!validatePhone(phone)) return res.status(400).json({ success: false, message: "Enter a valid phone number" });
  if (bloodGroup && !BLOOD_GROUPS.includes(bloodGroup)) return res.status(400).json({ success: false, message: "Invalid blood group" });
  if (age !== undefined && age !== "" && (isNaN(age) || Number(age) < 0 || Number(age) > 130)) {
    return res.status(400).json({ success: false, message: "Enter a valid age" });
  }
  const patient = { id: nextId("P", db.patients), name: name.trim(), age: Number(age) || null, gender, phone: phone.trim(), bloodGroup, address };
  db.patients.push(patient);
  await writeDb(db);
  sendItem(res, patient, 201);
}));

app.put("/api/patients/:id", safe(async (req, res) => {
  const db = await readDb();
  const idx = db.patients.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Patient not found" });
  db.patients[idx] = { ...db.patients[idx], ...req.body };
  await writeDb(db);
  sendItem(res, db.patients[idx]);
}));

app.delete("/api/patients/:id", safe(async (req, res) => {
  const db = await readDb();
  db.patients = db.patients.filter((p) => p.id !== req.params.id);
  await writeDb(db);
  res.json({ success: true });
}));

// ---------- Appointments ----------
app.get("/api/appointments", safe(async (req, res) => {
  const db = await readDb();
  sendList(res, db.appointments);
}));

app.post("/api/appointments", safe(async (req, res) => {
  const db = await readDb();
  const { patientId, department, doctor, date, time } = req.body;
  if (!patientId || !date || !time) return res.status(400).json({ success: false, message: "Patient, date and time are required" });
  const patient = db.patients.find((p) => p.id === patientId);
  const appt = {
    id: nextId("A", db.appointments),
    patientId,
    patientName: patient ? patient.name : "Unknown",
    department,
    doctor,
    date,
    time,
    status: "Scheduled"
  };
  db.appointments.push(appt);
  await writeDb(db);
  sendItem(res, appt, 201);
}));

app.put("/api/appointments/:id", safe(async (req, res) => {
  const db = await readDb();
  const idx = db.appointments.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Appointment not found" });
  db.appointments[idx] = { ...db.appointments[idx], ...req.body };
  await writeDb(db);
  sendItem(res, db.appointments[idx]);
}));

app.delete("/api/appointments/:id", safe(async (req, res) => {
  const db = await readDb();
  db.appointments = db.appointments.filter((a) => a.id !== req.params.id);
  await writeDb(db);
  res.json({ success: true });
}));

// ---------- Emergency Requests ----------
app.get("/api/emergency", safe(async (req, res) => {
  const db = await readDb();
  sendList(res, db.emergencyRequests);
}));

app.post("/api/emergency", safe(async (req, res) => {
  const db = await readDb();
  const { patientName, contact, location, urgency } = req.body;
  if (!patientName || !patientName.trim() || !location || !location.trim()) {
    return res.status(400).json({ success: false, message: "Patient name and location are required" });
  }
  if (!validatePhone(contact)) {
    return res.status(400).json({ success: false, message: "Enter a valid contact number" });
  }
  const request = {
    id: nextId("E", db.emergencyRequests),
    patientName,
    contact,
    location,
    urgency: urgency || "Medium",
    status: "Pending",
    createdAt: new Date().toISOString()
  };
  db.emergencyRequests.push(request);
  await writeDb(db);
  sendItem(res, request, 201);
}));

app.put("/api/emergency/:id", safe(async (req, res) => {
  const db = await readDb();
  const idx = db.emergencyRequests.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Request not found" });
  db.emergencyRequests[idx] = { ...db.emergencyRequests[idx], ...req.body };
  await writeDb(db);
  sendItem(res, db.emergencyRequests[idx]);
}));

// ---------- Ambulances ----------
app.get("/api/ambulances", safe(async (req, res) => {
  const db = await readDb();
  sendList(res, db.ambulances);
}));

app.post("/api/ambulances", safe(async (req, res) => {
  const db = await readDb();
  const { vehicleNo, driver, area, status } = req.body;
  if (!vehicleNo || !driver) return res.status(400).json({ success: false, message: "Vehicle number and driver are required" });
  const ambulance = { id: nextId("AM", db.ambulances), vehicleNo, driver, area, status: status || "Available" };
  db.ambulances.push(ambulance);
  await writeDb(db);
  sendItem(res, ambulance, 201);
}));

app.put("/api/ambulances/:id", safe(async (req, res) => {
  const db = await readDb();
  const idx = db.ambulances.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Ambulance not found" });
  db.ambulances[idx] = { ...db.ambulances[idx], ...req.body };
  await writeDb(db);
  sendItem(res, db.ambulances[idx]);
}));

// ---------- Blood Banks ----------
app.get("/api/blood-banks", safe(async (req, res) => {
  const db = await readDb();
  sendList(res, db.bloodBanks);
}));

app.get("/api/blood-banks/search", safe(async (req, res) => {
  const db = await readDb();
  const group = req.query.group;
  if (!group) return sendList(res, db.bloodBanks);
  const results = db.bloodBanks
    .filter((bank) => (bank.stock[group] || 0) > 0)
    .map((bank) => ({ ...bank, unitsAvailable: bank.stock[group] }));
  sendList(res, results);
}));

app.put("/api/blood-banks/:id", safe(async (req, res) => {
  const db = await readDb();
  const idx = db.bloodBanks.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Blood bank not found" });
  db.bloodBanks[idx] = { ...db.bloodBanks[idx], ...req.body, stock: { ...db.bloodBanks[idx].stock, ...(req.body.stock || {}) } };
  await writeDb(db);
  sendItem(res, db.bloodBanks[idx]);
}));

// ---------- Hospitals ----------
app.get("/api/hospitals", safe(async (req, res) => {
  const db = await readDb();
  const q = (req.query.q || "").toLowerCase();
  const results = q
    ? db.hospitals.filter((h) => h.name.toLowerCase().includes(q) || h.specialty.toLowerCase().includes(q) || h.address.toLowerCase().includes(q))
    : db.hospitals;
  sendList(res, results);
}));

app.post("/api/hospitals", safe(async (req, res) => {
  const db = await readDb();
  const { name, address, contact, specialty } = req.body;
  if (!name || !address) return res.status(400).json({ success: false, message: "Name and address are required" });
  const hospital = { id: nextId("H", db.hospitals), name, address, contact, specialty };
  db.hospitals.push(hospital);
  await writeDb(db);
  sendItem(res, hospital, 201);
}));

// Fallback to index.html for any non-API route (single-page app).
// Skipped on Vercel: there, static files under /public are served directly
// by the platform and never reach this function at all.
if (!process.env.VERCEL) {
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });
}

// Only start a persistent listener when run directly (`node server/server.js`
// or `npm start`), e.g. locally, on Render, Railway, or inside the Docker
// container for Cloud Run. On Vercel this file is imported by api/index.js
// as a serverless function instead, so app.listen must never run there.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Clinic Management System running on http://localhost:${PORT}`);
    console.log(`Storage backend: ${usingMongo ? "MongoDB Atlas" : "local JSON file (set MONGODB_URI to use MongoDB)"}`);
  });
}

module.exports = app;
