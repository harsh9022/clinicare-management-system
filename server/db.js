// Data layer with two backends:
//
//   1. MongoDB Atlas (used whenever MONGODB_URI is set) — real, durable
//      persistence that survives restarts and works even on serverless
//      platforms like Vercel where the local disk is read-only.
//   2. A local JSON file (used when MONGODB_URI is not set) — zero-setup
//      fallback for quick local testing without a database.
//
// The whole app state (patients, appointments, etc.) is stored as ONE
// document, so every route in server.js can keep working exactly as before —
// just with `await` in front of readDb()/writeDb() now that both backends
// are asynchronous.
const fs = require("fs");
const path = require("path");
const os = require("os");

const USE_MONGO = !!process.env.MONGODB_URI;

// ---------------- Seed data (shared by both backends) ----------------
function daysFromNow(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function seedData() {
  const today = daysFromNow(0);
  const tomorrow = daysFromNow(1);
  const dayAfter = daysFromNow(2);

  return {
    patients: [
      { id: "P001", name: "Asha Verma", age: 34, gender: "Female", phone: "9876500001", bloodGroup: "O+", address: "Kothrud, Pune" },
      { id: "P002", name: "Rohit Kulkarni", age: 45, gender: "Male", phone: "9876500002", bloodGroup: "B+", address: "Shivaji Nagar, Pune" },
      { id: "P003", name: "Meera Nair", age: 27, gender: "Female", phone: "9876500003", bloodGroup: "A-", address: "Baner, Pune" },
      { id: "P004", name: "Imran Sheikh", age: 58, gender: "Male", phone: "9876500004", bloodGroup: "AB+", address: "Hadapsar, Pune" },
      { id: "P005", name: "Sanjana Rao", age: 19, gender: "Female", phone: "9876500005", bloodGroup: "O-", address: "Viman Nagar, Pune" }
    ],
    // Dates are generated relative to today so the dashboard's "today" stats
    // are meaningful no matter when this app is first run.
    appointments: [
      { id: "A001", patientId: "P001", patientName: "Asha Verma", department: "General Medicine", doctor: "Dr. Patil", date: today, time: "10:00", status: "Scheduled" },
      { id: "A002", patientId: "P002", patientName: "Rohit Kulkarni", department: "Cardiology", doctor: "Dr. Shah", date: today, time: "11:30", status: "Scheduled" },
      { id: "A003", patientId: "P003", patientName: "Meera Nair", department: "Dermatology", doctor: "Dr. Iyer", date: tomorrow, time: "09:15", status: "Scheduled" },
      { id: "A004", patientId: "P004", patientName: "Imran Sheikh", department: "Orthopedics", doctor: "Dr. Deshmukh", date: dayAfter, time: "14:00", status: "Cancelled" }
    ],
    emergencyRequests: [
      { id: "E001", patientName: "Vikram Singh", contact: "9876511111", location: "Kothrud, Pune", urgency: "High", status: "Dispatched", createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
      { id: "E002", patientName: "Lata Joshi", contact: "9876522222", location: "Wakad, Pune", urgency: "Medium", status: "Pending", createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() }
    ],
    ambulances: [
      { id: "AM01", vehicleNo: "MH12-AB-1234", driver: "Suresh Pawar", area: "Kothrud", status: "On Duty" },
      { id: "AM02", vehicleNo: "MH12-CD-5678", driver: "Ramesh Jadhav", area: "Baner", status: "Available" },
      { id: "AM03", vehicleNo: "MH12-EF-9012", driver: "Ganesh More", area: "Hadapsar", status: "Available" },
      { id: "AM04", vehicleNo: "MH12-GH-3456", driver: "Vijay Kale", area: "Viman Nagar", status: "Unavailable" }
    ],
    bloodBanks: [
      { id: "B001", name: "Pune City Blood Bank", address: "FC Road, Pune", contact: "020-25511111", stock: { "A+": 12, "A-": 3, "B+": 18, "B-": 2, "O+": 25, "O-": 4, "AB+": 6, "AB-": 1 } },
      { id: "B002", name: "Sahyadri Blood Centre", address: "Deccan, Pune", contact: "020-25522222", stock: { "A+": 8, "A-": 1, "B+": 10, "B-": 0, "O+": 14, "O-": 2, "AB+": 3, "AB-": 0 } },
      { id: "B003", name: "Jeevan Blood Bank", address: "Hadapsar, Pune", contact: "020-25533333", stock: { "A+": 5, "A-": 2, "B+": 7, "B-": 1, "O+": 9, "O-": 3, "AB+": 2, "AB-": 1 } }
    ],
    hospitals: [
      { id: "H001", name: "Sunrise Multispeciality Clinic", address: "Kothrud, Pune", contact: "020-25611111", specialty: "General Medicine, Pediatrics" },
      { id: "H002", name: "Green Cross Hospital", address: "Baner, Pune", contact: "020-25622222", specialty: "Cardiology, Orthopedics" },
      { id: "H003", name: "Wellness Care Clinic", address: "Hadapsar, Pune", contact: "020-25633333", specialty: "Dermatology, ENT" },
      { id: "H004", name: "Om Sai Hospital", address: "Viman Nagar, Pune", contact: "020-25644444", specialty: "General Surgery" },
      { id: "H005", name: "Lifeline Emergency Center", address: "Shivaji Nagar, Pune", contact: "020-25655555", specialty: "Emergency & Trauma Care" }
    ]
  };
}

function nextId(prefix, list) {
  const nums = list
    .map((item) => parseInt(String(item.id).replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return prefix + String(next).padStart(3, "0");
}

// ---------------- MongoDB backend ----------------
let mongoClientPromise = null;
let cachedMongoDb = null;

async function getMongoDb() {
  if (cachedMongoDb) return cachedMongoDb;
  const { MongoClient, ServerApiVersion } = require("mongodb");
  if (!mongoClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
    });
    mongoClientPromise = client.connect();
  }
  const client = await mongoClientPromise;
  cachedMongoDb = client.db(process.env.MONGODB_DB || "clinicare");
  return cachedMongoDb;
}

async function mongoReadDb() {
  const db = await getMongoDb();
  const collection = db.collection("appState");
  let doc = await collection.findOne({ _id: "singleton" });
  if (!doc) {
    doc = { _id: "singleton", ...seedData() };
    await collection.insertOne(doc);
  }
  const { _id, ...data } = doc;
  return data;
}

async function mongoWriteDb(data) {
  const db = await getMongoDb();
  const collection = db.collection("appState");
  await collection.replaceOne({ _id: "singleton" }, { _id: "singleton", ...data }, { upsert: true });
}

// ---------------- JSON file backend (fallback / offline dev) ----------------
// On Vercel the deployed code directory is read-only — only os.tmpdir()
// (/tmp) can be written to. This branch only matters if MONGODB_URI is
// missing; with Mongo configured, Vercel gets real persistence too.
const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "clinicare-data")
  : path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensureFileDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(seedData(), null, 2));
  }
}

function fileReadDb() {
  ensureFileDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function fileWriteDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ---------------- Public interface ----------------
// Always async now, regardless of backend, so callers don't need to care
// which one is active.
async function readDb() {
  return USE_MONGO ? mongoReadDb() : fileReadDb();
}

async function writeDb(data) {
  return USE_MONGO ? mongoWriteDb(data) : fileWriteDb(data);
}

module.exports = { readDb, writeDb, nextId, usingMongo: USE_MONGO };
