// Every call returns { success, data|message } even on network failure,
// so callers never need a try/catch of their own.
async function request(url, options) {
  try {
    const res = await fetch(url, options);
    let body;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      return { success: false, message: (body && body.message) || `Request failed (${res.status})` };
    }
    return body || { success: false, message: "Empty response from server" };
  } catch (err) {
    return { success: false, message: "Could not reach the server. Check your connection and that the app is running." };
  }
}

const api = {
  get: (url) => request(url),
  post: (url, body) => request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  put: (url, body) => request(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  del: (url) => request(url, { method: "DELETE" })
};

function toast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("show", "toast-error");
  if (type === "error") el.classList.add("toast-error");
  void el.offsetWidth; // restart animation if triggered rapidly
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

function fieldError(form, message) {
  let el = form.querySelector(".field-error");
  if (!el) {
    el = document.createElement("span");
    el.className = "field-error";
    form.appendChild(el);
  }
  el.textContent = message || "";
}

// ---------- Mobile sidebar ----------
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("sidebar-overlay");
const menuToggle = document.getElementById("menu-toggle");

function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
  menuToggle.setAttribute("aria-expanded", "false");
}
menuToggle.addEventListener("click", () => {
  const opening = !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", opening);
  overlay.classList.toggle("show", opening);
  menuToggle.setAttribute("aria-expanded", String(opening));
});
overlay.addEventListener("click", closeSidebar);

function badge(text, className) {
  return `<span class="badge badge-${className}">${text}</span>`;
}

function statusBadgeClass(status) {
  return status.toLowerCase().replace(/\s+/g, "");
}

// ---------- Navigation ----------
const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");

navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    navItems.forEach((b) => b.classList.remove("active"));
    views.forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
    loadView(btn.dataset.view);
    closeSidebar();
  });
});

function loadView(view) {
  if (view === "dashboard") loadDashboard();
  if (view === "appointments") loadAppointments();
  if (view === "patients") loadPatients();
  if (view === "emergency") loadEmergency();
  if (view === "ambulances") loadAmbulances();
  if (view === "blood") loadBloodBanks();
  if (view === "hospitals") loadHospitals();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const { data } = await api.get("/api/stats");
  document.getElementById("stat-appointments-today").textContent = data.appointmentsToday;
  document.getElementById("stat-appointments-total").textContent = `${data.totalAppointments} total on record`;
  document.getElementById("stat-pending-emergency").textContent = data.pendingEmergencies;
  document.getElementById("stat-emergency-total").textContent = `${data.totalEmergencies} logged today`;
  document.getElementById("stat-ambulances-available").textContent = data.availableAmbulances;
  document.getElementById("stat-ambulances-total").textContent = `of ${data.totalAmbulances} vehicles`;
  document.getElementById("stat-patients-total").textContent = data.totalPatients;

  const max = Math.max(...Object.values(data.bloodTotals), 1);
  const grid = document.getElementById("blood-bar-grid");
  grid.innerHTML = Object.entries(data.bloodTotals).map(([group, units]) => `
    <div class="blood-bar-item">
      <div class="blood-bar-label"><span>${group}</span><span>${units} units</span></div>
      <div class="blood-bar-track"><div class="blood-bar-fill" style="width:${(units / max) * 100}%"></div></div>
    </div>
  `).join("");
}

// ---------- Appointments ----------
async function loadAppointments() {
  const [{ data: appointments }, { data: patients }] = await Promise.all([
    api.get("/api/appointments"),
    api.get("/api/patients")
  ]);

  const select = document.querySelector('#form-appointment select[name="patientId"]');
  select.innerHTML = `<option value="">Select patient</option>` + patients.map((p) => `<option value="${p.id}">${p.name} (${p.id})</option>`).join("");

  const body = document.getElementById("appointments-body");
  body.innerHTML = appointments.map((a) => `
    <tr>
      <td>${a.id}</td><td>${a.patientName}</td><td>${a.department || "—"}</td><td>${a.doctor || "—"}</td>
      <td>${a.date}</td><td>${a.time}</td>
      <td>${badge(a.status, statusBadgeClass(a.status))}</td>
      <td>
        ${a.status === "Scheduled" ? `
          <button class="btn-ghost" data-action="complete" data-id="${a.id}">Complete</button>
          <button class="btn-ghost" data-action="cancel" data-id="${a.id}">Cancel</button>` : ""}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="8">No appointments yet.</td></tr>`;

  body.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.dataset.action === "complete" ? "Completed" : "Cancelled";
      const res = await api.put(`/api/appointments/${btn.dataset.id}`, { status });
      if (res.success) toast(`Appointment marked ${status.toLowerCase()}`);
      else toast(res.message || "Could not update appointment", "error");
      loadAppointments();
    });
  });
}

document.getElementById("form-appointment").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  fieldError(form, "");
  btn.disabled = true;
  const payload = Object.fromEntries(new FormData(form).entries());
  const res = await api.post("/api/appointments", payload);
  btn.disabled = false;
  if (res.success) { toast("Appointment booked"); form.reset(); loadAppointments(); }
  else fieldError(form, res.message || "Could not book appointment");
});

// ---------- Patients ----------
async function loadPatients(query = "") {
  const { data } = await api.get(`/api/patients?q=${encodeURIComponent(query)}`);
  const body = document.getElementById("patients-body");
  body.innerHTML = data.map((p) => `
    <tr>
      <td>${p.id}</td><td>${p.name}</td><td>${p.age}</td><td>${p.gender}</td>
      <td>${p.phone}</td><td>${p.bloodGroup}</td><td>${p.address}</td>
      <td><button class="btn-ghost" data-id="${p.id}" data-action="delete-patient">Remove</button></td>
    </tr>
  `).join("") || `<tr><td colspan="8">No patients found.</td></tr>`;

  body.querySelectorAll('[data-action="delete-patient"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const name = row ? row.children[1].textContent : "this patient";
      if (!confirm(`Remove ${name}? This cannot be undone.`)) return;
      const res = await api.del(`/api/patients/${btn.dataset.id}`);
      if (res.success) { toast("Patient removed"); loadPatients(document.getElementById("patient-search").value); }
      else toast(res.message || "Could not remove patient", "error");
    });
  });
}

document.getElementById("form-patient").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  fieldError(form, "");
  btn.disabled = true;
  const payload = Object.fromEntries(new FormData(form).entries());
  const res = await api.post("/api/patients", payload);
  btn.disabled = false;
  if (res.success) { toast("Patient added"); form.reset(); loadPatients(); }
  else fieldError(form, res.message || "Could not add patient");
});

let patientSearchTimer;
document.getElementById("patient-search").addEventListener("input", (e) => {
  clearTimeout(patientSearchTimer);
  const value = e.target.value;
  patientSearchTimer = setTimeout(() => loadPatients(value), 250);
});

// ---------- Emergency ----------
async function loadEmergency() {
  const { data } = await api.get("/api/emergency");
  const body = document.getElementById("emergency-body");
  body.innerHTML = data.slice().reverse().map((e) => `
    <tr>
      <td>${e.id}</td><td>${e.patientName}</td><td>${e.contact}</td><td>${e.location}</td>
      <td>${badge(e.urgency, statusBadgeClass(e.urgency))}</td>
      <td>${badge(e.status, statusBadgeClass(e.status))}</td>
      <td>${new Date(e.createdAt).toLocaleString()}</td>
      <td>
        ${e.status !== "Completed" ? `
          ${e.status === "Pending" ? `<button class="btn-ghost" data-action="dispatch" data-id="${e.id}">Dispatch</button>` : ""}
          <button class="btn-ghost" data-action="complete-e" data-id="${e.id}">Complete</button>` : ""}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="8">No emergency requests logged.</td></tr>`;

  body.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.dataset.action === "dispatch" ? "Dispatched" : "Completed";
      const res = await api.put(`/api/emergency/${btn.dataset.id}`, { status });
      if (res.success) toast(`Request marked ${status.toLowerCase()}`);
      else toast(res.message || "Could not update request", "error");
      loadEmergency();
    });
  });
}

document.getElementById("form-emergency").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  fieldError(form, "");
  btn.disabled = true;
  const payload = Object.fromEntries(new FormData(form).entries());
  const res = await api.post("/api/emergency", payload);
  btn.disabled = false;
  if (res.success) { toast("Emergency request submitted"); form.reset(); loadEmergency(); }
  else fieldError(form, res.message || "Could not submit request");
});

// ---------- Ambulances ----------
async function loadAmbulances() {
  const { data } = await api.get("/api/ambulances");
  const body = document.getElementById("ambulances-body");
  body.innerHTML = data.map((a) => `
    <tr>
      <td>${a.id}</td><td>${a.vehicleNo}</td><td>${a.driver}</td><td>${a.area}</td>
      <td>${badge(a.status, statusBadgeClass(a.status))}</td>
      <td>
        <select data-id="${a.id}" class="status-select">
          <option ${a.status === "Available" ? "selected" : ""}>Available</option>
          <option ${a.status === "On Duty" ? "selected" : ""}>On Duty</option>
          <option ${a.status === "Unavailable" ? "selected" : ""}>Unavailable</option>
        </select>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6">No ambulances registered.</td></tr>`;

  body.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const res = await api.put(`/api/ambulances/${sel.dataset.id}`, { status: sel.value });
      if (res.success) toast("Ambulance status updated");
      else toast(res.message || "Could not update status", "error");
      loadAmbulances();
    });
  });
}

document.getElementById("form-ambulance").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  fieldError(form, "");
  btn.disabled = true;
  const payload = Object.fromEntries(new FormData(form).entries());
  const res = await api.post("/api/ambulances", payload);
  btn.disabled = false;
  if (res.success) { toast("Ambulance added"); form.reset(); loadAmbulances(); }
  else fieldError(form, res.message || "Could not add ambulance");
});

// ---------- Blood Bank ----------
async function loadBloodBanks(group = "") {
  const url = group ? `/api/blood-banks/search?group=${encodeURIComponent(group)}` : "/api/blood-banks";
  const { data } = await api.get(url);
  const container = document.getElementById("blood-cards");
  container.innerHTML = data.map((bank) => `
    <div class="info-card">
      <h3>${bank.name}</h3>
      <p>${bank.address}</p>
      <p>${bank.contact}</p>
      <div class="stock-grid">
        ${Object.entries(bank.stock).map(([g, units]) => `
          <div class="stock-pill ${units === 0 ? "zero" : ""}">${g}<br/>${units}</div>
        `).join("")}
      </div>
    </div>
  `).join("") || `<p>No blood banks match this search.</p>`;
}

document.getElementById("blood-search").addEventListener("change", (e) => loadBloodBanks(e.target.value));

// ---------- Hospitals ----------
async function loadHospitals(query = "") {
  const { data } = await api.get(`/api/hospitals?q=${encodeURIComponent(query)}`);
  const container = document.getElementById("hospital-cards");
  container.innerHTML = data.map((h) => `
    <div class="info-card">
      <h3>${h.name}</h3>
      <p>${h.address}</p>
      <p>${h.contact}</p>
      <p><strong>${h.specialty}</strong></p>
    </div>
  `).join("") || `<p>No facilities match this search.</p>`;
}

let hospitalSearchTimer;
document.getElementById("hospital-search").addEventListener("input", (e) => {
  clearTimeout(hospitalSearchTimer);
  const value = e.target.value;
  hospitalSearchTimer = setTimeout(() => loadHospitals(value), 250);
});

// ---------- Init ----------
loadDashboard();
