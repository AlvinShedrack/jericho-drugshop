const STORE = {
  users: "users",
  suppliers: "suppliers",
  medicines: "medicines",
  sales: "sales",
  purchases: "purchases",
  expenses: "expenses",
  auditLogs: "auditLogs"
};

const SESSION_KEY = "my_rx_session_user";
let currentUser = null;
let cart = [];
let purchaseLines = [];
let currentReceiptSale = null;
let editingSaleId = null;
let deferredInstallPrompt = null;

const BRAND = {
  name: "Jericho First Aid Drug Shop",
  tagline: "caring passionately for your health and drug needs",
  receiptTagline: "Thank you for choosing Jericho First Aid Drug Shop.",
  logo: "./assets/budadiri-logo.png",
  address: "Located at UTC, Namagumba Budadiri highway",
  phone: "0774 658 920 / 0753 635 469 / 0756 303 274",
  email: "annapatiencenuduwa@gmail.com"
};
const pageMeta = {
  dashboard: ["Dashboard", "Business overview and alerts"],
  inventory: ["Inventory", "Medicine stock, batches, prices, and expiry"],
  sales: ["Sales POS", "Sell medicine and print receipts"],
  purchases: ["Purchases", "Record stock-in and supplier purchases"],
  suppliers: ["Suppliers", "Supplier contacts and purchase source records"],
  reports: ["Reports", "Sales, profit, low stock, expiry, and stock value"],
  users: ["Users", "Manage local app users and roles"],
  backup: ["Backup", "Export and import offline data"]
};

function $(id) {
  return document.getElementById(id);
}

function formatMoney(amount) {
  return "USh " + Number(amount || 0).toLocaleString("en-UG", {
    maximumFractionDigits: 0
  });
}

function formatDateDisplay(dateString) {
  if (!dateString) return "";
  const raw = String(dateString).trim();

  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) return raw;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [yyyy, mm, dd] = raw.split("-");
    return `${dd}-${mm}-${yyyy}`;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  return raw;
}

function normalizeDateInput(value) {
  if (!value) return "";

  let input = String(value).trim().replaceAll("/", "-");

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [yyyy, mm, dd] = input.split("-");
    return `${dd}-${mm}-${yyyy}`;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(input)) {
    return input;
  }

  const digits = input.replace(/\D/g, "");
  if (digits.length === 8) {
    const dd = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    return `${dd}-${mm}-${yyyy}`;
  }

  return input;
}

function toIsoDate(dateString) {
  if (!dateString) return "";

  const value = String(dateString).trim().replaceAll("/", "-");

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
    const [dd, mm, yyyy] = value.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}

function attachDateMask(id) {
  const input = $(id);
  if (!input) return;

  input.addEventListener("input", event => {
    let value = event.target.value.replace(/\D/g, "").slice(0, 8);

    if (value.length > 4) {
      value = `${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4)}`;
    } else if (value.length > 2) {
      value = `${value.slice(0, 2)}-${value.slice(2)}`;
    }

    event.target.value = value;
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isSameDay(isoDate, dateString) {
  const left = String(isoDate || "").slice(0, 10);
  const right = toIsoDate(dateString) || String(dateString || "").slice(0, 10);

  return left === right;
}

function daysUntil(dateString) {
  if (!dateString) return -999999;

  const isoDate = toIsoDate(dateString);

  if (!isoDate) {
    return -999999;
  }

  const today = new Date(`${todayISO()}T00:00:00`);
  const target = new Date(`${isoDate}T00:00:00`);

  if (Number.isNaN(target.getTime())) {
    return -999999;
  }

  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function simpleHash(text) {
  let hash = 0;
  const input = String(text || "");
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return `h_${Math.abs(hash)}`;
}

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    console.log("Toast:", message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function requireRole(roles) {
  return currentUser && roles.includes(currentUser.role);
}

function isDispenser() {
  return currentUser?.role === "Dispenser";
}

function isAdministrator() {
  return currentUser?.role === "Administrator";
}

function isDirector() {
  return currentUser?.role === "Director";
}

function supplierName(suppliers, id) {
  const supplier = suppliers.find(item => Number(item.id) === Number(id));
  return supplier ? supplier.name : "Not set";
}
async function deleteCloudRecord(storeName, id) {
  if (typeof markCloudRecordDeleted === "function") {
    await markCloudRecordDeleted(storeName, id);
    return;
  }

  const { error } = await window.cloudClient
    .from("cloud_records")
    .delete()
    .eq("store_name", storeName)
    .eq("local_id", String(id));

  if (error) {
    throw error;
  }
}
async function seedInitialData() {
  const users = await getAll(STORE.users);
  const existingEmails = new Set(users.map(user => String(user.email || "").toLowerCase()));
  const defaultUsers = [
    {
      id: 1,
      name: "System Administrator",
      email: "admin@jericho.com",
      passwordHash: simpleHash("admin123"),
      role: "Administrator",
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 2,
      name: "Main Dispenser",
      email: "dispenser@jericho.com",
      passwordHash: simpleHash("disp123"),
      role: "Dispenser",
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 3,
      name: "Director",
      email: "director@jericho.com",
      passwordHash: simpleHash("director123"),
      role: "Director",
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  for (const user of defaultUsers) {
    const emailKey = String(user.email || "").toLowerCase();
    if (existingEmails.has(emailKey)) continue;
    await addRecord(STORE.users, user);
    existingEmails.add(emailKey);
  }

  const suppliers = await getAll(STORE.suppliers);
  if (!suppliers.length) {
    await addRecord(STORE.suppliers, {
      id: 1,
      name: "Default Supplier",
      phone: "",
      email: "",
      address: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}

async function writeAudit(action, details = {}) {
  if (!currentUser) return;
  await addRecord(STORE.auditLogs, {
    action,
    details,
    userId: currentUser.id,
    userName: currentUser.name,
    createdAt: new Date().toISOString()
  });
}

async function login(email, password) {
  const users = await getAll(STORE.users);
  const user = users.find(item => item.email.toLowerCase() === email.toLowerCase());

  if (!user || !user.isActive || user.passwordHash !== simpleHash(password)) {
    throw new Error("Invalid email or password.");
  }

  currentUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
  await writeAudit("login", { email: user.email });
  showApp();
}

function logout() {
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);

  document.body.classList.remove("is-authenticated");

  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
}

function showApp() {
  document.body.classList.add("is-authenticated");
  
  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("currentUserText").innerHTML = `<strong>${escapeHtml(currentUser.name)}</strong><br>${escapeHtml(currentUser.role)}`;
  applyRoleAccess();
  showPage("dashboard");
  refreshAll();

  if (typeof startAutoSync === "function") {
    startAutoSync();
  }
}

function applyRoleAccess() {
  const manager = ["Administrator", "Director"].includes(currentUser?.role);
  const directorOnly = currentUser?.role === "Director";

  // Admin / Director only
  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !manager);
  });

  // Director only
  document.querySelectorAll(".director-only").forEach(el => {
    el.classList.toggle("hidden", !directorOnly);
  });

  // Old class still used in your HTML: hide it from Dispenser
  document.querySelectorAll(".pharmacist-admin-only").forEach(el => {
    el.classList.toggle("hidden", !manager);
  });

  const saleType = $("saleType");
  if (saleType) {
    if (isDispenser()) {
      saleType.value = "retail";
      saleType.disabled = true;

      Array.from(saleType.options).forEach(option => {
        option.hidden = option.value !== "retail";
      });
    } else {
      saleType.disabled = false;

      Array.from(saleType.options).forEach(option => {
        option.hidden = false;
      });
    }
  }

  const usersNav = document.querySelector('.nav-link[data-page="users"]');
  if (usersNav) {
    usersNav.classList.toggle("hidden", !manager);
  }
}

function showPage(pageId) {
  if (pageId === "users" && !requireRole(["Administrator", "Director"])) {
    showToast("Only Administrator or Director can open Users.");
    return;
  }

  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach(link => link.classList.remove("active"));

  $(pageId).classList.add("active");
  const activeNavLink = document.querySelector(`.nav-link[data-page="${pageId}"]`);
  activeNavLink?.classList.add("active");

  if (window.innerWidth <= 768 && activeNavLink) {
    activeNavLink.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest"
    });
  }

  const [title, subtitle] = pageMeta[pageId] || ["My Rx", ""];
  $("pageTitle").textContent = title;
  $("pageSubtitle").textContent = subtitle;

  if (pageId === "reports") renderReports();
}

function openModal(id) {
  $(id).classList.remove("hidden");
}

function closeModal(id) {
  $(id).classList.add("hidden");
}

async function renderDashboard() {
  const medicines = await getAll(STORE.medicines);
  const sales = await getAll(STORE.sales);
  const today = todayISO();
  const todaySales = sales.filter(sale => isSameDay(sale.createdAt, today));
  const lowStock = medicines.filter(med => Number(med.quantity) <= Number(med.reorderLevel || 5));
  const expiring = medicines.filter(med => daysUntil(med.expiryDate) >= 0 && daysUntil(med.expiryDate) <= 90);
  const expired = medicines.filter(med => daysUntil(med.expiryDate) < 0);

  const todaySalesTotal = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const todayProfitTotal = todaySales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);
  const stockValue = medicines.reduce((sum, med) => sum + (Number(med.quantity || 0) * Number(med.buyingPrice || 0)), 0);

  $("dashTotalMedicines").textContent = medicines.length;
  $("dashLowStock").textContent = lowStock.length;
  $("dashExpiring").textContent = expiring.length;
  $("dashTodaySales").textContent = formatMoney(todaySalesTotal);
  $("dashTodayProfit").textContent = formatMoney(todayProfitTotal);
  $("dashStockValue").textContent = formatMoney(stockValue);

  const recent = sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  $("recentSalesTable").innerHTML = recent.length ? recent.map(sale => `
    <tr>
      <td>${escapeHtml(sale.receiptNo)}</td>
      <td>${escapeHtml(sale.customerName || "Walk-in")}</td>
      <td>${formatMoney(sale.total)}</td>
      <td>${new Date(sale.createdAt).toLocaleString()}</td>
    </tr>
  `).join("") : `<tr><td colspan="4">No sales yet.</td></tr>`;

  const alerts = [
    ...expired.slice(0, 5).map(med => ({ type: "danger", title: `${med.name} expired`, detail: `Batch ${med.batchNo} expired on ${med.expiryDate}` })),
    ...expiring.slice(0, 5).map(med => ({ type: "warning", title: `${med.name} expiring soon`, detail: `Batch ${med.batchNo} expires on ${med.expiryDate}` })),
    ...lowStock.slice(0, 5).map(med => ({ type: "info", title: `${med.name} low stock`, detail: `${med.quantity} left. Reorder level is ${med.reorderLevel || 5}.` }))
  ];

  $("alertsList").innerHTML = alerts.length ? alerts.slice(0, 8).map(alert => `
    <div class="alert-item">
      <div><strong>${escapeHtml(alert.title)}</strong><br><span class="muted">${escapeHtml(alert.detail)}</span></div>
      <span class="badge ${alert.type}">${alert.type}</span>
    </div>
  `).join("") : `<div class="warning-box">No priority alerts.</div>`;
}

async function renderInventory() {
  const medicines = await getAll(STORE.medicines);
  const suppliers = await getAll(STORE.suppliers);
  const medicineSearch = $("medicineSearch");
  const medicineStatusFilter = $("medicineStatusFilter");
  const canManagePricing = requireRole(["Administrator", "Director"]);
  const search = (medicineSearch?.value || "").toLowerCase().trim();
  const filter = medicineStatusFilter?.value || "all";

  let filtered = medicines.filter(med => {
    const supplier = supplierName(suppliers, med.supplierId).toLowerCase();
    const haystack = `${med.name} ${med.genericName} ${med.batchNo} ${med.category} ${supplier}`.toLowerCase();
    return haystack.includes(search);
  });

  filtered = filtered.filter(med => {
    const d = daysUntil(med.expiryDate);
    const isLow = Number(med.quantity) <= Number(med.reorderLevel || 5);
    if (filter === "low") return isLow;
    if (filter === "expiring") return d >= 0 && d <= 90;
    if (filter === "expired") return d < 0;
    return true;
  });

  filtered.sort((a, b) => a.name.localeCompare(b.name));

  $("medicineTable").innerHTML = filtered.length ? filtered.map(med => {
    const d = daysUntil(med.expiryDate);
    const stockBadge = Number(med.quantity) <= Number(med.reorderLevel || 5) ? "warning" : "success";
    const expiryBadge = d < 0 ? "danger" : d <= 90 ? "warning" : "success";
    const canEdit = requireRole(["Administrator", "Director"]);
    return `
      <tr>
        <td><strong>${escapeHtml(med.name)}</strong><br><span class="muted">${escapeHtml(med.genericName || "")}</span></td>
        <td>${escapeHtml(med.category || "")}</td>
        <td>${formatMoney(med.sellingPrice)}</td>
        ${canManagePricing ? `<td>${formatMoney(med.wholesalePrice)}</td>` : ""}
        <td>${Number(med.reorderLevel || 5)}</td>
        <td>${escapeHtml(med.notes || "")}</td>
        <td>
          ${canEdit ? `<button class="table-btn" data-action="edit-medicine" data-id="${med.id}">Edit</button>` : ""}
          ${canEdit ? `<button class="table-btn danger" data-action="delete-medicine" data-id="${med.id}">Delete</button>` : ""}
        </td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="9">No medicines found.</td></tr>`;
}

async function populateSupplierOptions() {
  const suppliers = await getAll(STORE.suppliers);
  const options = suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if ($("medicineSupplier")) $("medicineSupplier").innerHTML = `<option value="">Not set</option>${options}`;
  if ($("purchaseSupplierSelect")) $("purchaseSupplierSelect").innerHTML = suppliers.length ? options : `<option value="">Add supplier first</option>`;
}

async function populateMedicineOptions() {
  const medicines = await getAll(STORE.medicines);
  const canManagePricing = requireRole(["Administrator", "Director"]);
  const saleOptions = medicines
    .filter(med => Number(med.quantity) > 0 && daysUntil(med.expiryDate) >= 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(med => {
      const priceLabel = canManagePricing && med.wholesalePrice
        ? ` | Wholesale ${formatMoney(med.wholesalePrice)}`
        : "";
      return `<option value="${med.id}">${escapeHtml(med.name)} | Qty ${med.quantity} | ${formatMoney(med.sellingPrice)}${priceLabel}</option>`;
    }).join("");

  const purchaseOptions = medicines
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(med => `<option value="${med.id}">${escapeHtml(med.name)} | Batch ${escapeHtml(med.batchNo)}</option>`).join("");

  if ($("saleMedicineSelect")) $("saleMedicineSelect").innerHTML = saleOptions || `<option value="">No sellable medicine available</option>`;
  if ($("purchaseMedicineSelect")) $("purchaseMedicineSelect").innerHTML = purchaseOptions || `<option value="">Add medicine first</option>`;
}

async function openMedicineForm(id = null) {
  await populateSupplierOptions();
  $("medicineForm").reset();
  $("medicineId").value = "";
  $("reorderLevel").value = 5;

  if (id) {
    const med = await getById(STORE.medicines, id);
    if (!med) return;
    $("medicineModalTitle").textContent = "Edit Medicine";
    $("medicineId").value = med.id;
    $("medicineName").value = med.name || "";
    $("genericName").value = med.genericName || "";
    $("category").value = med.category || "";
    $("sellingPrice").value = med.sellingPrice || 0;
    $("wholesalePrice").value = med.wholesalePrice || 0;
    $("reorderLevel").value = med.reorderLevel || 5;
    $("medicineNotes").value = med.notes || "";
  } else {
    $("medicineModalTitle").textContent = "Add Medicine";
  }

  openModal("medicineModal");

  setTimeout(() => {
  const firstField = $("medicineName");
  if (firstField) {
    firstField.scrollIntoView({ block: "start", behavior: "smooth" });
    firstField.focus();
  }
}, 100);
}

async function saveMedicine(event) {
  event.preventDefault();

  if (!requireRole(["Administrator", "Director"])) {
    showToast("Only Admin or Director can save medicines.");
    return;
  }

  const id = $("medicineId").value;
  const existing = id ? await getById(STORE.medicines, id) : null;
  const record = {
    ...(existing || {}),
    name: $("medicineName").value.trim(),
    genericName: $("genericName").value.trim(),
    category: $("category").value.trim(),
    sellingPrice: Number($("sellingPrice").value || 0),
    wholesalePrice: Number($("wholesalePrice").value || 0),
    reorderLevel: Number($("reorderLevel").value || 5),
    notes: $("medicineNotes").value.trim(),
    updatedAt: new Date().toISOString()
  };

  if (!record.name) {
    showToast("Medicine name is required.");
    return;
  }

  if (id) {
    await putRecord(STORE.medicines, record);
    await writeAudit("medicine_updated", { id: Number(id), name: record.name });
  } else {
    record.createdAt = new Date().toISOString();
    await addRecord(STORE.medicines, record);
    await writeAudit("medicine_created", { name: record.name });
  }

  closeModal("medicineModal");
  showToast("Medicine saved.");
  await refreshAll();
  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}

async function deleteMedicine(id) {
  if (!requireRole(["Administrator", "Director"])) return showToast("Not allowed.");

  const med = await getById(STORE.medicines, id);
  if (!med) return;

  if (!confirm(`Delete ${med.name}?`)) return;

  try {
    await deleteEverywhere(STORE.medicines, id);
    await writeAudit("medicine_deleted", { id, name: med.name });

    showToast("Medicine deleted.");
    await refreshAll();

    if (typeof queueAutoSync === "function") {
      queueAutoSync();
    }
  } catch (error) {
    console.error("Delete medicine error:", error);
    showToast(error.message || "Medicine delete failed.");
  }
}

async function renderSuppliers() {
  const suppliers = await getAll(STORE.suppliers);
  const canEdit = requireRole(["Administrator", "Director"]);

  $("suppliersTable").innerHTML = suppliers.length ? suppliers.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${escapeHtml(s.phone || "")}</td>
      <td>${escapeHtml(s.email || "")}</td>
      <td>${escapeHtml(s.address || "")}</td>
      <td>
        ${canEdit ? `<button class="table-btn" data-action="edit-supplier" data-id="${s.id}">Edit</button>` : ""}
        ${canEdit ? `<button class="table-btn danger" data-action="delete-supplier" data-id="${s.id}">Delete</button>` : ""}
      </td>
    </tr>
  `).join("") : `<tr><td colspan="5">No suppliers yet.</td></tr>`;
}

async function openSupplierForm(id = null) {
  $("supplierForm").reset();
  $("supplierId").value = "";

  if (id) {
    const supplier = await getById(STORE.suppliers, id);
    if (!supplier) return;
    $("supplierModalTitle").textContent = "Edit Supplier";
    $("supplierId").value = supplier.id;
    $("supplierName").value = supplier.name || "";
    $("supplierPhone").value = supplier.phone || "";
    $("supplierEmail").value = supplier.email || "";
    $("supplierAddress").value = supplier.address || "";
  } else {
    $("supplierModalTitle").textContent = "Add Supplier";
  }

  openModal("supplierModal");
}

async function renderDashboardMedicineSearch() {
  const medicines = await getAll(STORE.medicines);
  const query = ($("dashMedicineSearch")?.value || "").toLowerCase().trim();
  const canManagePricing = requireRole(["Administrator", "Director"]);

  const filtered = medicines
    .filter(med => {
      const text = `${med.name} ${med.genericName} ${med.batchNo}`.toLowerCase();
      return text.includes(query);
    })
    .slice(0, 10);

  const container = $("dashboardPriceResults");
  if (!container) return;

  if (!query) {
    container.innerHTML = `<div class="muted">Search a medicine name to see its prices.</div>`;
    return;
  }

  container.innerHTML = filtered.length ? filtered.map(med => `
    <div class="price-search-item">
      <strong>${escapeHtml(med.name)}</strong>
      <div>Retail: ${formatMoney(med.sellingPrice)}</div>
      ${canManagePricing ? `<div>Wholesale: ${formatMoney(med.wholesalePrice)}</div>` : ""}
      <div>Available Qty: ${Number(med.quantity || 0)}</div>
    </div>
  `).join("") : `<div class="muted">No medicine found.</div>`;
}

async function saveSupplier(event) {
  event.preventDefault();
  if (!requireRole(["Administrator", "Director"])) return showToast("Not allowed.");

  const id = $("supplierId").value;
  const existing = id ? await getById(STORE.suppliers, id) : null;
  const record = {
    ...(existing || {}),
    name: $("supplierName").value.trim(),
    phone: $("supplierPhone").value.trim(),
    email: $("supplierEmail").value.trim(),
    address: $("supplierAddress").value.trim(),
    updatedAt: new Date().toISOString()
  };

  if (!record.name) return showToast("Supplier name is required.");

  if (id) await putRecord(STORE.suppliers, record);
  else await addRecord(STORE.suppliers, { ...record, createdAt: new Date().toISOString() });

  await writeAudit(id ? "supplier_updated" : "supplier_created", { name: record.name });
  closeModal("supplierModal");
  showToast("Supplier saved.");
  await refreshAll();
  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}

async function deleteSupplier(id) {
  if (!requireRole(["Administrator", "Director"])) return showToast("Not allowed.");

  const supplier = await getById(STORE.suppliers, id);
  if (!supplier) return;

  if (!confirm(`Delete supplier ${supplier.name}?`)) return;

  try {
    await deleteEverywhere(STORE.suppliers, id);
    await writeAudit("supplier_deleted", { id, name: supplier.name });

    showToast("Supplier deleted.");
    await refreshAll();

    if (typeof queueAutoSync === "function") {
      queueAutoSync();
    }
  } catch (error) {
    console.error("Delete supplier error:", error);
    showToast(error.message || "Supplier delete failed.");
  }
}

async function addToCart() {
  const saleMedicineSelect = $("saleMedicineSelect");
  const saleQtyInput = $("saleQty");
  const saleDiscountInput = $("saleDiscount");

  if (!saleMedicineSelect || !saleQtyInput || !saleDiscountInput) {
    showToast("Sales form is not ready yet.");
    return;
  }

  const medicineId = Number(saleMedicineSelect.value);
  const qty = Number(saleQtyInput.value || 0);
  const discount = Number(saleDiscountInput.value || 0);

  if (!medicineId || qty <= 0) return showToast("Select medicine and quantity.");

  const med = await getById(STORE.medicines, medicineId);
  if (!med) return showToast("Medicine not found.");
  if (daysUntil(med.expiryDate) < 0) return showToast("Cannot sell expired medicine.");

  const existingQty = cart.filter(item => item.medicineId === medicineId).reduce((sum, item) => sum + item.qty, 0);
  if (existingQty + qty > Number(med.quantity)) return showToast("Insufficient stock.");

  const saleType = $("saleType")?.value || "retail";
  let effectivePrice = Number(med.sellingPrice || 0);
  if (saleType === "wholesale") {
    effectivePrice = med.wholesalePrice ? Number(med.wholesalePrice) : Math.round(effectivePrice * 0.9);
  }

  cart.push({
    medicineId,
    name: med.name,
    batchNo: med.batchNo,
    qty,
    sellingPrice: effectivePrice,
    buyingPrice: Number(med.buyingPrice || 0),
    discount: Math.max(0, discount),
    saleType
  });

  if (saleQtyInput) saleQtyInput.value = "";
  if (saleDiscountInput) saleDiscountInput.value = "";
  renderCart();
}

function renderCart() {
  $("cartTable").innerHTML = cart.length ? cart.map((item, index) => {
    const subtotal = item.qty * item.sellingPrice;
    const total = Math.max(0, subtotal - item.discount);
    return `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong><br><span class="muted">Batch ${escapeHtml(item.batchNo)}</span></td>
        <td>${item.qty}</td>
        <td>${formatMoney(item.sellingPrice)}</td>
        <td>${formatMoney(item.discount)}</td>
        <td>${formatMoney(total)}</td>
        <td><button class="table-btn danger" data-action="remove-cart" data-index="${index}">Remove</button></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="6">Cart is empty.</td></tr>`;

  const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.sellingPrice), 0);
  const discount = cart.reduce((sum, item) => sum + item.discount, 0);
  const total = Math.max(0, subtotal - discount);

  $("cartSubtotal").textContent = formatMoney(subtotal);
  $("cartDiscount").textContent = formatMoney(discount);
  $("cartTotal").textContent = formatMoney(total);
}

function resetSaleEditState() {
  editingSaleId = null;
  const completeButton = $("completeSaleBtn");
  if (completeButton) {
    completeButton.textContent = "Complete Sale";
  }
  const note = $("saleEditNote");
  if (note) {
    note.textContent = "";
  }
}

async function editSale(id) {
  const sale = await getById(STORE.sales, id);
  if (!sale) {
    return showToast("Sale not found.");
  }

  editingSaleId = id;
  cart = Array.isArray(sale.lines) ? sale.lines.map(line => ({ ...line })) : [];
  $("saleCustomer").value = sale.customerName || "";
  $("salePaymentMethod").value = sale.paymentMethod || "Cash";
  $("saleType").value = sale.saleType || "retail";

  const completeButton = $("completeSaleBtn");
  if (completeButton) {
    completeButton.textContent = "Update Sale";
  }

  const note = $("saleEditNote");
  if (note) {
    note.textContent = `Editing sale ${sale.receiptNo}`;
  }

  renderCart();
}

async function renderSalesHistory() {
  const sales = await getAll(STORE.sales);
  const canDelete = requireRole(["Administrator", "Director"]);

  const rows = sales
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(sale => `
      <tr>
        <td>${escapeHtml(sale.receiptNo)}</td>
        <td>${escapeHtml(sale.customerName || "Walk-in customer")}</td>
        <td>${formatMoney(sale.total)}</td>
        <td>${formatDateDisplay(sale.createdAt)}</td>
        <td>
          <button class="table-btn" data-action="edit-sale" data-id="${sale.id}">Edit</button>
          ${canDelete ? `<button class="table-btn danger" data-action="delete-sale" data-id="${sale.id}">Delete</button>` : ""}
        </td>
      </tr>
    `).join("");

  $("salesHistoryTable").innerHTML = rows || `<tr><td colspan="5">No sales recorded yet.</td></tr>`;
}
async function deleteSale(id) {
  if (!requireRole(["Administrator", "Director"])) {
    return showToast("Only Administrator or Director can delete sales.");
  }

  const sale = await getById(STORE.sales, id);
  if (!sale) {
    return showToast("Sale not found.");
  }

  if (!confirm(`Delete sale ${sale.receiptNo}? This will return the sold stock back to inventory.`)) {
    return;
  }

  try {
    if (Array.isArray(sale.lines)) {
      for (const item of sale.lines) {
        const med = await getById(STORE.medicines, item.medicineId);
        if (!med) continue;

        med.quantity = Number(med.quantity || 0) + Number(item.qty || 0);
        med.updatedAt = new Date().toISOString();

        await putRecord(STORE.medicines, med);
      }
    }

    await deleteEverywhere(STORE.sales, id);

    await writeAudit("sale_deleted", {
      id,
      receiptNo: sale.receiptNo,
      total: sale.total
    });

    if (Number(editingSaleId) === Number(id)) {
      cart = [];
      resetSaleEditState();
      renderCart();
    }

    showToast("Sale deleted and stock restored.");
    await refreshAll();

    if (typeof queueAutoSync === "function") {
      queueAutoSync();
    }
  } catch (error) {
    console.error("Delete sale error:", error);
    showToast(error.message || "Sale delete failed.");
  }
}
async function completeSale() {
  if (!cart.length) return showToast("Cart is empty.");

  const medicines = await getAll(STORE.medicines);
  for (const item of cart) {
    const med = medicines.find(m => Number(m.id) === Number(item.medicineId));
    if (!med || Number(med.quantity) < Number(item.qty)) {
      return showToast(`Insufficient stock for ${item.name}.`);
    }
  }

  const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.sellingPrice), 0);
  const discount = cart.reduce((sum, item) => sum + item.discount, 0);
  const total = Math.max(0, subtotal - discount);

  let amountPaid = Number(prompt(`Grand total is ${formatMoney(total)}.\nEnter amount paid by customer:`) || 0);

  if (Number.isNaN(amountPaid) || amountPaid < total) {
    return showToast("Amount paid must be equal to or greater than total.");
  }

  const changeGiven = amountPaid - total;

  const profit = cart.reduce((sum, item) => {
    const itemRevenue = Math.max(0, (item.qty * item.sellingPrice) - item.discount);
    const itemCost = item.qty * item.buyingPrice;
    return sum + (itemRevenue - itemCost);
  }, 0);

  for (const item of cart) {
    const med = await getById(STORE.medicines, item.medicineId);
    med.quantity = Number(med.quantity) - Number(item.qty);
    med.updatedAt = new Date().toISOString();
    await putRecord(STORE.medicines, med);
  }

  const saleType = $("saleType")?.value || "retail";
  let originalSale = null;

  if (editingSaleId) {
    originalSale = await getById(STORE.sales, editingSaleId);
    if (!originalSale) {
      showToast("Original sale not found.");
      resetSaleEditState();
      return;
    }
  }

  const stockRecords = await getAll(STORE.medicines);

  if (editingSaleId && originalSale?.lines) {
    for (const item of originalSale.lines) {
      const med = stockRecords.find(m => Number(m.id) === Number(item.medicineId));
      if (!med) continue;
      med.quantity = Number(med.quantity || 0) + Number(item.qty || 0);
      med.updatedAt = new Date().toISOString();
      await putRecord(STORE.medicines, med);
    }
  }

  for (const item of cart) {
    const med = await getById(STORE.medicines, item.medicineId);
    if (!med || Number(med.quantity) < Number(item.qty)) {
      return showToast(`Insufficient stock for ${item.name}.`);
    }
  }

  const saleData = {
    receiptNo: editingSaleId ? originalSale.receiptNo : `JD-${Date.now()}`,
    customerName: $("saleCustomer").value.trim() || "Walk-in customer",
    paymentMethod: $("salePaymentMethod").value,
    saleType,
    cashierId: currentUser.id,
    cashierName: currentUser.name,
    subtotal,
    discount,
    total,
    amountPaid,
    changeGiven,
    profit,
    lines: cart.map(item => ({ ...item })),
    createdAt: editingSaleId ? originalSale.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  for (const item of cart) {
    const med = await getById(STORE.medicines, item.medicineId);
    med.quantity = Number(med.quantity) - Number(item.qty);
    med.updatedAt = new Date().toISOString();
    await putRecord(STORE.medicines, med);
  }

  if (editingSaleId) {
    saleData.id = Number(editingSaleId);
    await putRecord(STORE.sales, saleData);
    await writeAudit("sale_updated", { receiptNo: saleData.receiptNo, total, amountPaid, changeGiven });
    showToast("Sale updated.");
  } else {
    const saleId = await addRecord(STORE.sales, saleData);
    const savedSale = { ...saleData, id: saleId };
    await writeAudit("sale_completed", { receiptNo: saleData.receiptNo, total, amountPaid, changeGiven });
    showReceipt(savedSale);
    showToast(`Sale completed. Change: ${formatMoney(changeGiven)}`);
  }

  cart = [];
  $("saleCustomer").value = "";
  resetSaleEditState();
  renderCart();
  await refreshAll();
  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}

function showReceipt(sale) {
  currentReceiptSale = sale;

  const subtotal = Number(sale.subtotal || sale.total || 0);
  const discount = Number(sale.discount || 0);
  const total = Number(sale.total || 0);
  const amountPaid = Number(sale.amountPaid || 0);
  const changeGiven = Number(sale.changeGiven || 0);

  $("receiptContent").innerHTML = `
    <img src="${BRAND.logo}" class="receipt-watermark" alt="" />

    <div class="receipt-inner">
      <div class="receipt-brand-header">
        <img src="${BRAND.logo}" alt="${BRAND.name}" />
        <h2>${BRAND.name}</h2>
        <p>${BRAND.tagline}</p>
        <div class="receipt-contact-line">
          ${BRAND.address}<br>
          Tel: ${BRAND.phone}
        </div>
      </div>

      <div class="receipt-title">Sales Receipt</div>

      <div class="receipt-meta-grid">
        <div>
          <strong>Receipt No.:</strong>
          <span>${escapeHtml(sale.receiptNo)}</span>
        </div>

        <div>
          <strong>Cashier:</strong>
          <span>${escapeHtml(sale.cashierName)}</span>
        </div>

        <div>
          <strong>Date:</strong>
          <span>${formatDateDisplay(sale.createdAt)}</span>
        </div>

        <div>
          <strong>Payment:</strong>
          <span>${escapeHtml(sale.paymentMethod)}</span>
        </div>

        <div>
          <strong>Time:</strong>
          <span>${new Date(sale.createdAt).toLocaleTimeString()}</span>
        </div>

        <div>
          <strong>Customer:</strong>
          <span>${escapeHtml(sale.customerName)}</span>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>

        <tbody>
          ${sale.lines.map((item, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(item.name)}</td>
              <td>${item.qty}</td>
              <td>${formatMoney(item.sellingPrice)}</td>
              <td>${formatMoney((item.qty * item.sellingPrice) - item.discount)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div class="receipt-total-box">
        <div class="receipt-total-line">
          <span>Subtotal</span>
          <strong>${formatMoney(subtotal)}</strong>
        </div>

        <div class="receipt-total-line">
          <span>Discount</span>
          <strong>${formatMoney(discount)}</strong>
        </div>

        <div class="receipt-total-line">
          <span>Amount Paid</span>
          <strong>${formatMoney(amountPaid)}</strong>
        </div>

        <div class="receipt-total-line">
          <span>Change</span>
          <strong>${formatMoney(changeGiven)}</strong>
        </div>

        <div class="receipt-total-line grand">
          <span>Grand Total</span>
          <strong>${formatMoney(total)}</strong>
        </div>
      </div>

      <div class="receipt-footer-note">
        ${BRAND.receiptTagline}
        <span>${BRAND.address}</span>
      </div>
    </div>
  `;

  openModal("receiptModal");
}

function renderPurchaseLines() {
  $("purchaseLinesTable").innerHTML = purchaseLines.length ? purchaseLines.map((item, index) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td>${escapeHtml(item.batchNo)}</td>
      <td>${escapeHtml(formatDateDisplay(item.expiryDate))}</td>
      <td>${item.qty}</td>
      <td>${formatMoney(item.unitCost)}</td>
      <td>${formatMoney(item.retailPrice || 0)}</td>
      <td>${formatMoney(item.qty * item.unitCost)}</td>
      <td><button class="table-btn danger" data-action="remove-purchase-line" data-index="${index}">Remove</button></td>
    </tr>
  `).join("") : `<tr><td colspan="8">No purchase lines.</td></tr>`;

  const total = purchaseLines.reduce((sum, item) => sum + (item.qty * item.unitCost), 0);
  $("purchaseTotal").textContent = formatMoney(total);
}

async function addPurchaseLine() {
  if (!requireRole(["Administrator", "Director"])) {
    return showToast("Only Admin or Pharmacist can add purchases.");
  }

  const medicineId = Number($("purchaseMedicineSelect").value);
  const batchNo = $("purchaseBatchNo").value.trim();
  const expiryDate = normalizeDateInput($("purchaseExpiryDate").value);
  const qty = Number($("purchaseQty").value || 0);
  const unitCost = Number($("purchaseCost").value || 0);
  const retailPrice = Number($("purchaseRetailPrice").value || 0);

  if (!medicineId || !batchNo || !expiryDate || qty <= 0 || unitCost < 0 || retailPrice < 0) {
    return showToast("Select medicine, batch number, expiry date, quantity, buying price, and retail price.");
  }

  const med = await getById(STORE.medicines, medicineId);
  if (!med) return showToast("Medicine not found.");

  purchaseLines.push({
    medicineId,
    name: med.name,
    batchNo,
    expiryDate,
    qty,
    unitCost,
    retailPrice
  });

  $("purchaseBatchNo").value = "";
  $("purchaseExpiryDate").value = "";
  $("purchaseQty").value = "";
  $("purchaseCost").value = "";
  $("purchaseRetailPrice").value = "";

  renderPurchaseLines();
}

async function completePurchase() {
  if (!requireRole(["Administrator", "Director"])) return showToast("Not allowed.");
  if (!purchaseLines.length) return showToast("No purchase lines.");

  const supplierId = Number($("purchaseSupplierSelect").value);
  const invoiceNo = $("purchaseInvoice").value.trim() || `PINV-${Date.now()}`;
  const purchaseDate = normalizeDateInput($("purchaseDate").value || formatDateDisplay(new Date().toISOString()));
  const total = purchaseLines.reduce((sum, item) => sum + (item.qty * item.unitCost), 0);

  for (const line of purchaseLines) {
    const med = await getById(STORE.medicines, line.medicineId);
    if (!med) continue;

    med.quantity = Number(med.quantity || 0) + Number(line.qty);
    med.buyingPrice = Number(line.unitCost || med.buyingPrice || 0);
    med.sellingPrice = Number(line.retailPrice || med.sellingPrice || 0);

    med.batchNo = line.batchNo;
    med.expiryDate = line.expiryDate;

    if (supplierId) {
      med.supplierId = supplierId;
    }

    med.updatedAt = new Date().toISOString();

    await putRecord(STORE.medicines, med);
  }

  await addRecord(STORE.purchases, {
    supplierId,
    invoiceNo,
    purchaseDate,
    total,
    lines: purchaseLines.map(line => ({ ...line })),
    createdBy: currentUser.id,
    createdByName: currentUser.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await writeAudit("purchase_saved", { invoiceNo, total });
  purchaseLines = [];
  $("purchaseInvoice").value = "";
  $("purchaseDate").value = "";
  renderPurchaseLines();
  showToast("Purchase saved and stock updated.");
  await refreshAll();
  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}

async function renderReports() {
  const reportDate = $("reportDate").value || todayISO();
  $("reportDate").value = reportDate;
    if ($("reportIdText")) {
    $("reportIdText").textContent = `SR-${reportDate.replaceAll("-", "")}`;
  }

  if ($("reportGeneratedOnText")) {
    $("reportGeneratedOnText").textContent = new Date().toLocaleString();
  }

  if ($("reportGeneratedByText")) {
    $("reportGeneratedByText").textContent = currentUser ? currentUser.name : "System User";
  }

  const medicines = await getAll(STORE.medicines);
  const sales = await getAll(STORE.sales);
  const selectedSales = sales.filter(sale => isSameDay(sale.createdAt, reportDate));
  const salesTotal = selectedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const profitTotal = selectedSales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);
  const lowStock = medicines.filter(med => Number(med.quantity) <= Number(med.reorderLevel || 5));
  const expired = medicines.filter(med => daysUntil(med.expiryDate) < 0);
  const expiring = medicines.filter(med => daysUntil(med.expiryDate) >= 0 && daysUntil(med.expiryDate) <= 90);

  $("reportSalesTotal").textContent = formatMoney(salesTotal);
  $("reportProfitTotal").textContent = formatMoney(profitTotal);
  $("reportLowStock").textContent = lowStock.length;
  $("reportExpired").textContent = expired.length;

  $("reportSalesTable").innerHTML = selectedSales.length ? selectedSales.map(sale => `
    <tr>
      <td>${escapeHtml(sale.receiptNo)}</td>
      <td>${escapeHtml(sale.customerName)}</td>
      <td>${formatMoney(sale.total)}</td>
      <td>${formatMoney(sale.profit)}</td>
      <td>${new Date(sale.createdAt).toLocaleTimeString()}</td>
    </tr>
  `).join("") : `<tr><td colspan="5">No sales for selected date.</td></tr>`;

  const alerts = [...expired, ...expiring, ...lowStock]
    .filter((item, index, self) => index === self.findIndex(x => x.id === item.id));

  $("reportAlertsTable").innerHTML = alerts.length ? alerts.map(med => {
    const d = daysUntil(med.expiryDate);
    let status = "OK";
    let badge = "success";
    if (d < 0) { status = "Expired"; badge = "danger"; }
    else if (d <= 90) { status = "Expiring"; badge = "warning"; }
    if (Number(med.quantity) <= Number(med.reorderLevel || 5)) {
      status += status === "OK" ? "Low stock" : " + Low stock";
      if (badge !== "danger") badge = "warning";
    }
    return `
      <tr>
        <td>${escapeHtml(med.name)}</td>
        <td>${med.quantity}</td>
        <td>${escapeHtml(formatDateDisplay(med.expiryDate))}</td>
        <td><span class="badge ${badge}">${escapeHtml(status)}</span></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="4">No low stock or expiry alerts.</td></tr>`;
}

async function exportSalesCsv() {
  const sales = await getAll(STORE.sales);
  const rows = [["Receipt", "Customer", "Payment", "Subtotal", "Discount", "Total", "Profit", "Cashier", "Sale Type", "Date"]];
  sales.forEach(sale => {
    rows.push([
      sale.receiptNo,
      sale.customerName,
      sale.paymentMethod,
      sale.subtotal,
      sale.discount,
      sale.total,
      sale.profit,
      sale.cashierName,
      sale.saleType || "retail",
      sale.createdAt
    ]);
  });
  downloadFile(`my-rx-sales-${todayISO()}.csv`, rows.map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv");
}

async function exportPurchasesCsv() {
  const purchases = await getAll(STORE.purchases);
  const suppliers = await getAll(STORE.suppliers);
  const rows = [["Invoice", "Supplier", "Total Cost", "Created By", "Created By Name", "Date"]];
  purchases.forEach(purchase => {
    const supplier = suppliers.find(s => Number(s.id) === Number(purchase.supplierId));
    rows.push([
      purchase.invoiceNo,
      supplier ? supplier.name : "Unknown",
      purchase.total,
      purchase.createdBy,
      purchase.createdByName,
      purchase.createdAt
    ]);
  });
  downloadFile(`my-rx-purchases-${todayISO()}.csv`, rows.map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv");
}

async function renderUsers() {
  if (!requireRole(["Administrator", "Director"])) return;
  const users = await getAll(STORE.users);
  $("usersTable").innerHTML = users.map(user => `
    <tr>
      <td><strong>${escapeHtml(user.name)}</strong></td>
      <td>${escapeHtml(user.email)}</td>
      <td><span class="badge info">${escapeHtml(user.role)}</span></td>
      <td><span class="badge ${user.isActive ? "success" : "danger"}">${user.isActive ? "Active" : "Inactive"}</span></td>
      <td>
        <button class="table-btn" data-action="edit-user" data-id="${user.id}">Edit</button>
        ${Number(user.id) !== Number(currentUser.id) ? `<button class="table-btn danger" data-action="delete-user" data-id="${user.id}">Delete</button>` : ""}
      </td>
    </tr>
  `).join("");
}

async function openUserForm(id = null) {
  if (!requireRole(["Administrator", "Director"])) return showToast("Only Admin can manage users.");
  $("userForm").reset();
  $("userId").value = "";

  if (id) {
    const user = await getById(STORE.users, id);
    if (!user) return;
    $("userModalTitle").textContent = "Edit User";
    $("userId").value = user.id;
    $("userName").value = user.name;
    $("userEmail").value = user.email;
    $("userRole").value = user.role;
    $("userActive").value = String(Boolean(user.isActive));
    $("userPassword").placeholder = "Leave blank to keep current password";
  } else {
    $("userModalTitle").textContent = "Add User";
    $("userPassword").placeholder = "Required for new user";
  }

  openModal("userModal");
}

async function saveUser(event) {
  event.preventDefault();
  if (!requireRole(["Administrator", "Director"])) return showToast("Only Admin can save users.");

  const id = $("userId").value;
  const existing = id ? await getById(STORE.users, id) : null;
  const password = $("userPassword").value;

  if (!id && !password) return showToast("Password is required for new user.");

  const record = {
    ...(existing || {}),
    name: $("userName").value.trim(),
    email: $("userEmail").value.trim().toLowerCase(),
    role: $("userRole").value,
    isActive: $("userActive").value === "true",
    updatedAt: new Date().toISOString()
  };

  if (password) record.passwordHash = simpleHash(password);

  if (id) await putRecord(STORE.users, record);
  else await addRecord(STORE.users, { ...record, createdAt: new Date().toISOString() });

  await writeAudit(id ? "user_updated" : "user_created", { email: record.email, role: record.role });
  closeModal("userModal");
  showToast("User saved.");
  await refreshAll();
  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}

async function deleteUser(id) {
  if (!requireRole(["Administrator", "Director"])) return showToast("Only Admin can delete users.");
  if (Number(id) === Number(currentUser.id)) return showToast("You cannot delete your own user while logged in.");

  const user = await getById(STORE.users, id);
  if (!user) return;

  if (!confirm(`Delete user ${user.name}?`)) return;

  try {
    await deleteEverywhere(STORE.users, id);
    await writeAudit("user_deleted", { id, email: user.email });

    showToast("User deleted.");
    await refreshAll();

    if (typeof queueAutoSync === "function") {
      queueAutoSync();
    }
  } catch (error) {
    console.error("Delete user error:", error);
    showToast(error.message || "User delete failed.");
  }
}

function downloadFile(filename, content, type = "application/json") {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function browserPrint(modeClass, message) {
  document.body.classList.add(modeClass);

  const cleanup = () => {
    document.body.classList.remove(modeClass);
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);

  setTimeout(() => {
    window.print();
    showToast(message);
  }, 50);

  // Safety cleanup for browsers that do not fire afterprint consistently.
  setTimeout(cleanup, 5000);
}

function canUseHtml2Pdf() {
  return typeof window.html2pdf === "function";
}

/* =========================================================
   PROFESSIONAL PRINT / PDF REPORTS
   Replace the old printOrExportPdf() and printOrExportPagePdf()
   with this full block.
========================================================= */

function safeDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function safeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString();
}

function reportStyles() {
  return `
    <style>
      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: #f8fafc;
        color: #0f172a;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12px;
        line-height: 1.45;
      }

      .report-page {
        position: relative;
        width: 100%;
        max-width: 1120px;
        margin: 0 auto;
        background: #ffffff;
        padding: 28px;
        overflow: hidden;
      }

      .report-watermark {
        position: absolute;
        width: 42%;
        max-width: 420px;
        opacity: 0.045;
        top: 48%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 0;
        pointer-events: none;
      }

      .report-page > *:not(.report-watermark) {
        position: relative;
        z-index: 1;
      }

      .report-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 24px;
        border-bottom: 3px solid #0057b8;
        padding-bottom: 16px;
        margin-bottom: 22px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .brand-logo-img {
        width: 58px;
        height: 58px;
        object-fit: contain;
        border-radius: 12px;
        background: #ffffff;
      }

      .brand h1 {
        margin: 0;
        font-size: 20px;
        letter-spacing: -0.02em;
        color: #0057b8;
        text-transform: uppercase;
      }

      .brand p {
        margin: 3px 0 0;
        color: #0b8f2a;
        font-weight: 700;
      }

      .report-meta {
        text-align: right;
        color: #334155;
        font-size: 11px;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        padding: 10px;
        background: #f8fbff;
      }

      .report-title {
        margin-bottom: 18px;
      }

      .report-title h2 {
        margin: 0 0 4px;
        font-size: 22px;
        color: #0057b8;
        text-transform: uppercase;
      }

      .report-title p {
        margin: 0;
        color: #64748b;
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin: 16px 0 22px;
      }

      .summary-card {
        border: 1px solid #bfdbfe;
        border-left: 4px solid #0057b8;
        padding: 11px 12px;
        background: rgba(248, 251, 255, 0.92);
        border-radius: 10px;
      }

      .summary-card span {
        display: block;
        color: #64748b;
        font-size: 10px;
        text-transform: uppercase;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .summary-card strong {
        display: block;
        margin-top: 5px;
        font-size: 16px;
        color: #0057b8;
      }

      .section {
        margin-top: 20px;
        page-break-inside: avoid;
      }

      .section h3 {
        margin: 0 0 8px;
        font-size: 15px;
        color: #0057b8;
        border-bottom: 1px solid #bfdbfe;
        padding-bottom: 6px;
        text-transform: uppercase;
      }

      .info-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin: 10px 0 16px;
      }

      .info-box {
        border: 1px solid #e2e8f0;
        padding: 9px;
        background: rgba(248, 250, 252, 0.92);
        border-radius: 8px;
      }

      .info-box span {
        display: block;
        color: #64748b;
        font-size: 10px;
        text-transform: uppercase;
        font-weight: 700;
      }

      .info-box strong {
        display: block;
        margin-top: 4px;
        color: #0f172a;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
        page-break-inside: auto;
        background: rgba(255, 255, 255, 0.92);
      }

      thead {
        display: table-header-group;
      }

      tr {
        page-break-inside: avoid;
      }

      th {
        background: #0057b8;
        color: #ffffff;
        text-align: left;
        padding: 8px;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        border: 1px solid #0057b8;
      }

      td {
        padding: 8px;
        border: 1px solid #bfdbfe;
        vertical-align: top;
      }

      tbody tr:nth-child(even) {
        background: rgba(248, 251, 255, 0.75);
      }

      .text-right {
        text-align: right;
      }

      .text-center {
        text-align: center;
      }

      .muted {
        color: #64748b;
      }

      .status {
        font-weight: 700;
      }

      .status-danger {
        color: #b91c1c;
      }

      .status-warning {
        color: #b45309;
      }

      .status-success {
        color: #15803d;
      }

      .empty-box {
        border: 1px dashed #cbd5e1;
        background: rgba(248, 250, 252, 0.92);
        padding: 14px;
        color: #64748b;
        border-radius: 8px;
      }

      .totals-box {
        width: 320px;
        margin-left: auto;
        margin-top: 14px;
        border: 1px solid #bfdbfe;
        background: rgba(255, 255, 255, 0.92);
      }

      .total-line {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 11px;
        border-bottom: 1px solid #e2e8f0;
      }

      .total-line:last-child {
        border-bottom: none;
        font-weight: 800;
        font-size: 14px;
        background: #eaf3ff;
        color: #0057b8;
      }

      .approval-box {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
        margin-top: 26px;
      }

      .approval-box div {
        border: 1px solid #bfdbfe;
        padding: 12px;
        border-radius: 10px;
      }

      .approval-line {
        display: block;
        border-bottom: 1px solid #0f172a;
        height: 24px;
        margin-top: 10px;
      }

      .footer {
        margin-top: 28px;
        padding-top: 12px;
        border-top: 1px solid #bfdbfe;
        color: #64748b;
        font-size: 10px;
        display: flex;
        justify-content: space-between;
        gap: 18px;
      }

      @media print {
        body {
          background: #ffffff;
        }

        .report-page {
          max-width: none;
          padding: 0;
        }

        a[href]::after {
          content: "" !important;
        }

        @page {
          size: A4 portrait;
          margin: 12mm;
        }
      }
    </style>
  `;
}

function reportShell(title, subtitle, bodyHtml) {
  const printedBy = currentUser
    ? `${escapeHtml(currentUser.name)} (${escapeHtml(currentUser.role)})`
    : "Unknown user";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(title)}</title>
      ${reportStyles()}
    </head>

    <body>
      <main class="report-page">
        <img src="${BRAND.logo}" class="report-watermark" alt="" />

        <header class="report-header">
          <div class="brand">
            <img src="${BRAND.logo}" class="brand-logo-img" alt="${BRAND.name}" />
            <div>
              <h1>${BRAND.name}</h1>
              <p>${BRAND.tagline}</p>
            </div>
          </div>

          <div class="report-meta">
            <strong>Generated:</strong> ${safeDateTime(new Date().toISOString())}<br>
            <strong>Printed By:</strong> ${printedBy}<br>
            <strong>Address:</strong> ${BRAND.address}<br>
            <strong>Phone:</strong> ${BRAND.phone}
          </div>
        </header>

        <section class="report-title">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(subtitle || "")}</p>
        </section>

        ${bodyHtml}

        <section class="approval-box">
          <div>
            <strong>Approved By:</strong>
            <span class="approval-line"></span>
          </div>
          <div>
            <strong>Date:</strong>
            <span class="approval-line"></span>
          </div>
        </section>

        <footer class="footer">
          <span>Generated by ${BRAND.name}</span>
          <span>${BRAND.email}</span>
        </footer>
      </main>
    </body>
    </html>
  `;
}

function summaryCard(label, value) {
  return `
    <div class="summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function infoBox(label, value) {
  return `
    <div class="info-box">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function makeTable(headers, rows, emptyMessage = "No records found.") {
  if (!rows.length) {
    return `<div class="empty-box">${escapeHtml(emptyMessage)}</div>`;
  }

  return `
    <table>
      <thead>
        <tr>
          ${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>
  `;
}

function medicineStatus(med) {
  const d = daysUntil(med.expiryDate);
  const isLow = Number(med.quantity) <= Number(med.reorderLevel || 5);

  if (d < 0 && isLow) return { label: "Expired + Low Stock", className: "status-danger" };
  if (d < 0) return { label: "Expired", className: "status-danger" };
  if (d <= 90 && isLow) return { label: "Expiring Soon + Low Stock", className: "status-warning" };
  if (d <= 90) return { label: "Expiring Soon", className: "status-warning" };
  if (isLow) return { label: "Low Stock", className: "status-warning" };

  return { label: "OK", className: "status-success" };
}

function printHtmlDocument(html) {
  const frame = document.createElement("iframe");

  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";

  document.body.appendChild(frame);

  const frameWindow = frame.contentWindow;
  const frameDocument = frameWindow.document;

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  const removeFrame = () => {
    setTimeout(() => {
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    }, 800);
  };

  frameWindow.addEventListener("afterprint", removeFrame);

  setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
  }, 300);

  setTimeout(removeFrame, 8000);
}

async function buildDashboardReport() {
  const medicines = await getAll(STORE.medicines);
  const sales = await getAll(STORE.sales);
  const today = todayISO();

  const todaySales = sales.filter(sale => isSameDay(sale.createdAt, today));
  const lowStock = medicines.filter(med => Number(med.quantity) <= Number(med.reorderLevel || 5));
  const expiring = medicines.filter(med => daysUntil(med.expiryDate) >= 0 && daysUntil(med.expiryDate) <= 90);
  const expired = medicines.filter(med => daysUntil(med.expiryDate) < 0);

  const todaySalesTotal = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const todayProfitTotal = todaySales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);
  const stockValue = medicines.reduce((sum, med) => sum + (Number(med.quantity || 0) * Number(med.buyingPrice || 0)), 0);

  const recentSales = [...sales]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 15);

  const alerts = [
    ...expired.map(med => ({
      medicine: med.name,
      batch: med.batchNo,
      detail: `Expired on ${med.expiryDate}`,
      status: "Expired"
    })),
    ...expiring.map(med => ({
      medicine: med.name,
      batch: med.batchNo,
      detail: `Expires on ${med.expiryDate}`,
      status: "Expiring Soon"
    })),
    ...lowStock.map(med => ({
      medicine: med.name,
      batch: med.batchNo,
      detail: `${med.quantity} left. Reorder level is ${med.reorderLevel || 5}`,
      status: "Low Stock"
    }))
  ].slice(0, 25);

  const body = `
    <div class="summary-grid">
      ${summaryCard("Total Medicines", medicines.length)}
      ${summaryCard("Low Stock", lowStock.length)}
      ${summaryCard("Expiring Soon", expiring.length)}
      ${summaryCard("Expired", expired.length)}
      ${summaryCard("Today's Sales", formatMoney(todaySalesTotal))}
      ${summaryCard("Today's Profit", formatMoney(todayProfitTotal))}
      ${summaryCard("Stock Value", formatMoney(stockValue))}
      ${summaryCard("Report Date", today)}
    </div>

    <section class="section">
      <h3>Recent Sales</h3>
      ${makeTable(
        ["Receipt", "Customer", "Payment", "Total", "Profit", "Date"],
        recentSales.map(sale => `
          <tr>
            <td>${escapeHtml(sale.receiptNo)}</td>
            <td>${escapeHtml(sale.customerName || "Walk-in")}</td>
            <td>${escapeHtml(sale.paymentMethod || "")}</td>
            <td class="text-right">${formatMoney(sale.total)}</td>
            <td class="text-right">${formatMoney(sale.profit)}</td>
            <td>${safeDateTime(sale.createdAt)}</td>
          </tr>
        `),
        "No sales have been recorded yet."
      )}
    </section>

    <section class="section">
      <h3>Priority Stock Alerts</h3>
      ${makeTable(
        ["Medicine", "Batch", "Alert", "Status"],
        alerts.map(alert => `
          <tr>
            <td>${escapeHtml(alert.medicine)}</td>
            <td>${escapeHtml(alert.batch)}</td>
            <td>${escapeHtml(alert.detail)}</td>
            <td><span class="status">${escapeHtml(alert.status)}</span></td>
          </tr>
        `),
        "No priority stock alerts."
      )}
    </section>
  `;

  return reportShell("Dashboard Report", "Business overview, sales summary, stock value, and alerts.", body);
}

async function buildInventoryReport() {
  const medicines = await getAll(STORE.medicines);
  const suppliers = await getAll(STORE.suppliers);

  const search = $("medicineSearch")?.value.toLowerCase().trim() || "";
  const filter = $("medicineStatusFilter")?.value || "all";

  let filtered = medicines.filter(med => {
    const supplier = supplierName(suppliers, med.supplierId).toLowerCase();
    const haystack = `${med.name} ${med.genericName} ${med.batchNo} ${med.category} ${supplier}`.toLowerCase();
    return haystack.includes(search);
  });

  filtered = filtered.filter(med => {
    const d = daysUntil(med.expiryDate);
    const isLow = Number(med.quantity) <= Number(med.reorderLevel || 5);

    if (filter === "low") return isLow;
    if (filter === "expiring") return d >= 0 && d <= 90;
    if (filter === "expired") return d < 0;

    return true;
  });

  filtered.sort((a, b) => a.name.localeCompare(b.name));

  const totalQty = filtered.reduce((sum, med) => sum + Number(med.quantity || 0), 0);
  const stockValue = filtered.reduce((sum, med) => sum + (Number(med.quantity || 0) * Number(med.buyingPrice || 0)), 0);
  const retailValue = filtered.reduce((sum, med) => sum + (Number(med.quantity || 0) * Number(med.sellingPrice || 0)), 0);
  const lowStockCount = filtered.filter(med => Number(med.quantity) <= Number(med.reorderLevel || 5)).length;

  const body = `
    <div class="summary-grid">
      ${summaryCard("Filtered Medicines", filtered.length)}
      ${summaryCard("Total Quantity", totalQty)}
      ${summaryCard("Low Stock Items", lowStockCount)}
      ${summaryCard("Stock Cost Value", formatMoney(stockValue))}
      ${summaryCard("Retail Stock Value", formatMoney(retailValue))}
      ${summaryCard("Search Applied", search || "None")}
      ${summaryCard("Filter Applied", filter)}
      ${summaryCard("Generated", todayISO())}
    </div>

    <section class="section">
      <h3>Medicine Inventory Listing</h3>
      ${makeTable(
        ["Medicine", "Generic", "Batch", "Category", "Supplier", "Qty", "Buy", "Sell", "Wholesale", "Expiry", "Status"],
        filtered.map(med => {
          const status = medicineStatus(med);

          return `
            <tr>
              <td>${escapeHtml(med.name)}</td>
              <td>${escapeHtml(med.genericName || "")}</td>
              <td>${escapeHtml(med.batchNo || "")}</td>
              <td>${escapeHtml(med.category || "")}</td>
              <td>${escapeHtml(supplierName(suppliers, med.supplierId))}</td>
              <td class="text-right">${Number(med.quantity || 0)}</td>
              <td class="text-right">${formatMoney(med.buyingPrice)}</td>
              <td class="text-right">${formatMoney(med.sellingPrice)}</td>
              <td class="text-right">${formatMoney(med.wholesalePrice)}</td>
              <td>${escapeHtml(med.expiryDate || "")}</td>
              <td><span class="status ${status.className}">${escapeHtml(status.label)}</span></td>
            </tr>
          `;
        }),
        "No medicines match the selected filters."
      )}
    </section>
  `;

  return reportShell("Inventory Report", "Professional stock listing with quantities, pricing, expiry, and status.", body);
}

async function buildSalesReport() {
  const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.sellingPrice), 0);
  const discount = cart.reduce((sum, item) => sum + Number(item.discount || 0), 0);
  const total = Math.max(0, subtotal - discount);

  const customer = $("saleCustomer")?.value.trim() || "Walk-in customer";
  const paymentMethod = $("salePaymentMethod")?.value || "Cash";
  const saleType = $("saleType")?.value || "retail";

  const body = `
    <div class="info-grid">
      ${infoBox("Customer / Patient", customer)}
      ${infoBox("Payment Method", paymentMethod)}
      ${infoBox("Sale Type", saleType.toUpperCase())}
    </div>

    <section class="section">
      <h3>Current Sale Items</h3>
      ${makeTable(
        ["Medicine", "Batch", "Qty", "Unit Price", "Discount", "Line Total"],
        cart.map(item => {
          const lineTotal = Math.max(0, (Number(item.qty) * Number(item.sellingPrice)) - Number(item.discount || 0));

          return `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.batchNo || "")}</td>
              <td class="text-right">${Number(item.qty || 0)}</td>
              <td class="text-right">${formatMoney(item.sellingPrice)}</td>
              <td class="text-right">${formatMoney(item.discount)}</td>
              <td class="text-right">${formatMoney(lineTotal)}</td>
            </tr>
          `;
        }),
        "The cart is currently empty."
      )}

      <div class="totals-box">
        <div class="total-line"><span>Subtotal</span><strong>${formatMoney(subtotal)}</strong></div>
        <div class="total-line"><span>Total Discount</span><strong>${formatMoney(discount)}</strong></div>
        <div class="total-line"><span>Total Due</span><strong>${formatMoney(total)}</strong></div>
      </div>
    </section>
  `;

  return reportShell("Sales POS Report", "Current sale draft prepared for review, printing, or PDF saving.", body);
}

async function buildPurchasesReport() {
  const suppliers = await getAll(STORE.suppliers);
  const purchases = await getAll(STORE.purchases);

  const supplierId = Number($("purchaseSupplierSelect")?.value || 0);
  const supplier = suppliers.find(item => Number(item.id) === supplierId);
  const invoiceNo = $("purchaseInvoice")?.value.trim() || "Not entered";
  const currentTotal = purchaseLines.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unitCost || 0)), 0);

  const recentPurchases = [...purchases]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 15);

  const body = `
    <div class="info-grid">
      ${infoBox("Supplier", supplier ? supplier.name : "Not selected")}
      ${infoBox("Invoice Number", invoiceNo)}
      ${infoBox("Current Draft Total", formatMoney(currentTotal))}
    </div>

    <section class="section">
      <h3>Current Purchase Lines</h3>
      ${makeTable(
        ["Medicine", "Batch", "Qty", "Unit Cost", "Line Total"],
        purchaseLines.map(item => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.batchNo || "")}</td>
            <td class="text-right">${Number(item.qty || 0)}</td>
            <td class="text-right">${formatMoney(item.unitCost)}</td>
            <td class="text-right">${formatMoney(Number(item.qty || 0) * Number(item.unitCost || 0))}</td>
          </tr>
        `),
        "No purchase lines have been added."
      )}

      <div class="totals-box">
        <div class="total-line"><span>Total Cost</span><strong>${formatMoney(currentTotal)}</strong></div>
      </div>
    </section>

    <section class="section">
      <h3>Recent Saved Purchases</h3>
      ${makeTable(
        ["Invoice", "Supplier", "Total Cost", "Created By", "Date"],
        recentPurchases.map(purchase => {
          const purchaseSupplier = suppliers.find(s => Number(s.id) === Number(purchase.supplierId));

          return `
            <tr>
              <td>${escapeHtml(purchase.invoiceNo || "")}</td>
              <td>${escapeHtml(purchaseSupplier ? purchaseSupplier.name : "Unknown")}</td>
              <td class="text-right">${formatMoney(purchase.total)}</td>
              <td>${escapeHtml(purchase.createdByName || "")}</td>
              <td>${safeDateTime(purchase.createdAt)}</td>
            </tr>
          `;
        }),
        "No saved purchases yet."
      )}
    </section>
  `;

  return reportShell("Purchases Report", "Stock-in draft and recent supplier purchase history.", body);
}

async function buildSuppliersReport() {
  const suppliers = await getAll(STORE.suppliers);

  const body = `
    <div class="summary-grid">
      ${summaryCard("Total Suppliers", suppliers.length)}
      ${summaryCard("Report Date", todayISO())}
      ${summaryCard("Generated By", currentUser?.name || "Unknown")}
      ${summaryCard("Data Source", "Local Device")}
    </div>

    <section class="section">
      <h3>Supplier Directory</h3>
      ${makeTable(
        ["Supplier Name", "Phone", "Email", "Address"],
        suppliers.map(supplier => `
          <tr>
            <td>${escapeHtml(supplier.name)}</td>
            <td>${escapeHtml(supplier.phone || "")}</td>
            <td>${escapeHtml(supplier.email || "")}</td>
            <td>${escapeHtml(supplier.address || "")}</td>
          </tr>
        `),
        "No suppliers have been added."
      )}
    </section>
  `;

  return reportShell("Suppliers Report", "Professional supplier contact directory.", body);
}

async function buildReportsPageReport() {
  const reportDate = $("reportDate")?.value || todayISO();

  const medicines = await getAll(STORE.medicines);
  const sales = await getAll(STORE.sales);

  const selectedSales = sales.filter(sale => isSameDay(sale.createdAt, reportDate));
  const salesTotal = selectedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const profitTotal = selectedSales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);

  const lowStock = medicines.filter(med => Number(med.quantity) <= Number(med.reorderLevel || 5));
  const expired = medicines.filter(med => daysUntil(med.expiryDate) < 0);
  const expiring = medicines.filter(med => daysUntil(med.expiryDate) >= 0 && daysUntil(med.expiryDate) <= 90);

  const alerts = [...expired, ...expiring, ...lowStock]
    .filter((item, index, self) => index === self.findIndex(x => Number(x.id) === Number(item.id)));

  const body = `
    <div class="summary-grid">
      ${summaryCard("Selected Date", reportDate)}
      ${summaryCard("Sales Total", formatMoney(salesTotal))}
      ${summaryCard("Profit Total", formatMoney(profitTotal))}
      ${summaryCard("Transactions", selectedSales.length)}
      ${summaryCard("Low Stock Items", lowStock.length)}
      ${summaryCard("Expired Items", expired.length)}
      ${summaryCard("Expiring Soon", expiring.length)}
      ${summaryCard("Total Alerts", alerts.length)}
    </div>

    <section class="section">
      <h3>Sales for Selected Day</h3>
      ${makeTable(
        ["Receipt", "Customer", "Payment", "Sale Type", "Total", "Profit", "Time"],
        selectedSales.map(sale => `
          <tr>
            <td>${escapeHtml(sale.receiptNo)}</td>
            <td>${escapeHtml(sale.customerName || "Walk-in")}</td>
            <td>${escapeHtml(sale.paymentMethod || "")}</td>
            <td>${escapeHtml(sale.saleType || "retail")}</td>
            <td class="text-right">${formatMoney(sale.total)}</td>
            <td class="text-right">${formatMoney(sale.profit)}</td>
            <td>${safeTime(sale.createdAt)}</td>
          </tr>
        `),
        "No sales for the selected date."
      )}
    </section>

    <section class="section">
      <h3>Low Stock / Expiry Alerts</h3>
      ${makeTable(
        ["Medicine", "Batch", "Qty", "Reorder Level", "Expiry", "Status"],
        alerts.map(med => {
          const status = medicineStatus(med);

          return `
            <tr>
              <td>${escapeHtml(med.name)}</td>
              <td>${escapeHtml(med.batchNo || "")}</td>
              <td class="text-right">${Number(med.quantity || 0)}</td>
              <td class="text-right">${Number(med.reorderLevel || 5)}</td>
              <td>${escapeHtml(med.expiryDate || "")}</td>
              <td><span class="status ${status.className}">${escapeHtml(status.label)}</span></td>
            </tr>
          `;
        }),
        "No low stock or expiry alerts."
      )}
    </section>
  `;

  return reportShell("Daily Reports", "Sales, profit, low stock, expiry, and performance report.", body);
}

async function buildUsersReport() {
  if (!requireRole(["Administrator", "Director"])) {
    return reportShell(
      "Users Report",
      "Access restricted.",
      `<div class="empty-box">Only Admin users can print the Users & Roles report.</div>`
    );
  }

  const users = await getAll(STORE.users);

  const activeUsers = users.filter(user => user.isActive).length;
  const inactiveUsers = users.length - activeUsers;

  const body = `
    <div class="summary-grid">
      ${summaryCard("Total Users", users.length)}
      ${summaryCard("Active Users", activeUsers)}
      ${summaryCard("Inactive Users", inactiveUsers)}
      ${summaryCard("Generated", todayISO())}
    </div>

    <section class="section">
      <h3>Users & Roles</h3>
      ${makeTable(
        ["Name", "Email", "Role", "Status", "Created"],
        users.map(user => `
          <tr>
            <td>${escapeHtml(user.name)}</td>
            <td>${escapeHtml(user.email)}</td>
            <td>${escapeHtml(user.role)}</td>
            <td>${user.isActive ? "Active" : "Inactive"}</td>
            <td>${safeDateTime(user.createdAt)}</td>
          </tr>
        `),
        "No users found."
      )}
    </section>
  `;

  return reportShell("Users & Roles Report", "User access list without passwords or sensitive authentication data.", body);
}

async function buildBackupReport() {
  const users = await getAll(STORE.users);
  const suppliers = await getAll(STORE.suppliers);
  const medicines = await getAll(STORE.medicines);
  const sales = await getAll(STORE.sales);
  const purchases = await getAll(STORE.purchases);
  const auditLogs = await getAll(STORE.auditLogs);

  const body = `
    <div class="summary-grid">
      ${summaryCard("Users", users.length)}
      ${summaryCard("Suppliers", suppliers.length)}
      ${summaryCard("Medicines", medicines.length)}
      ${summaryCard("Sales", sales.length)}
      ${summaryCard("Purchases", purchases.length)}
      ${summaryCard("Audit Logs", auditLogs.length)}
      ${summaryCard("Generated", todayISO())}
      ${summaryCard("Storage", "Browser / Device")}
    </div>

    <section class="section">
      <h3>Backup Summary</h3>
      <div class="empty-box">
        This page prints a backup summary only. Use the <strong>Export Full Backup</strong> button inside the app to download the full JSON backup file.
      </div>
    </section>
  `;

  return reportShell("Backup & Restore Report", "Local data counts and backup readiness summary.", body);
}

async function buildProfessionalPageReport(pageId) {
  if (pageId === "dashboard") return buildDashboardReport();
  if (pageId === "inventory") return buildInventoryReport();
  if (pageId === "sales") return buildSalesReport();
  if (pageId === "purchases") return buildPurchasesReport();
  if (pageId === "suppliers") return buildSuppliersReport();
  if (pageId === "reports") return buildReportsPageReport();
  if (pageId === "users") return buildUsersReport();
  if (pageId === "backup") return buildBackupReport();

  return reportShell(
    "My Rx Report",
    "Professional printable report.",
    `<div class="empty-box">No printable report is configured for this page.</div>`
  );
}

async function printOrExportPagePdf() {
  try {
    const activePage = document.querySelector(".page.active");

    if (!activePage) {
      showToast("No page to print.");
      return;
    }

    const pageId = activePage.id || "page";
    const html = await buildProfessionalPageReport(pageId);

    printHtmlDocument(html);
    showToast("Professional report prepared for printing.");
  } catch (error) {
    console.error("Professional page print failed:", error);
    showToast("Could not prepare professional report.");
  }
}

async function printOrExportPdf() {
  const receiptContent = $("receiptContent");

  if (!receiptContent || !receiptContent.innerHTML.trim()) {
    showToast("No receipt to print.");
    return;
  }

  printElement("receiptContent", "Sales Receipt");
  showToast("Receipt prepared for printing.");
}

async function exportBackup() {
  const backup = await exportAllData();
  downloadFile(`my-rx-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2));
  await writeAudit("backup_exported", {});
  showToast("Backup exported.");
}

async function importBackup(file) {
  if (!file) return;

  const confirmed = confirm(
    "Importing this backup will replace the current data on this device. Continue?"
  );

  if (!confirmed) {
    $("importBackupInput").value = "";
    return;
  }

  try {
    const text = await file.text();

    if (!text.trim()) {
      throw new Error("Backup file is empty.");
    }

    const backup = JSON.parse(text);

    await importAllData(backup);

    currentUser = null;
    localStorage.removeItem(SESSION_KEY);

    showToast("Backup imported successfully. Please sign in again.");

    setTimeout(() => {
      location.reload();
    }, 1200);
  } catch (error) {
    console.error("Backup import failed:", error);
    showToast(error.message || "Backup import failed.");
  } finally {
    $("importBackupInput").value = "";
  }
}

async function refreshAll() {
  await populateSupplierOptions();
  await populateMedicineOptions();
  await renderDashboard();
  await renderInventory();
  await renderSuppliers();
  await renderUsers();
  await renderReports();
  await renderSalesHistory();
  await renderDashboardMedicineSearch();
  renderCart();
  renderPurchaseLines();
  await renderPurchaseExpenses();
}
function printElement(elementId, title = "Print") {
  const element = $(elementId);
  if (!element) return showToast("Nothing to print.");

  const printWindow = window.open("", "_blank", "width=900,height=1100");

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <link rel="stylesheet" href="./src/styles.css" />
        <style>
          @page {
            size: A4;
            margin: 0;
          }

          html,
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }

          body {
            padding: 10mm !important;
            font-family: Arial, sans-serif;
          }

          .no-print,
          button {
            display: none !important;
          }

          a[href]::after {
            content: "" !important;
          }

          .panel,
          .receipt-content {
            box-shadow: none !important;
            border: none !important;
          }

          .table-wrap {
            overflow: visible !important;
          }

          table {
            page-break-inside: auto;
          }

          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
        </style>
      </head>

      <body>
        ${element.outerHTML}

        <script>
          window.onload = function () {
            setTimeout(function () {
              window.print();
              window.close();
            }, 500);
          };
        <\/script>
      </body>
    </html>
  `);

  printWindow.document.close();
}

async function markReceiptAsPrinted() {
  if (!currentReceiptSale || !currentReceiptSale.id) return;

  const sale = await getById(STORE.sales, currentReceiptSale.id);
  if (!sale) return;

  if (!sale.printedAt) {
    sale.printedAt = new Date().toISOString();
    sale.locked = true;
    sale.lockedReason = "Receipt printed";
    sale.updatedAt = new Date().toISOString();

    await putRecord(STORE.sales, sale);

    await writeAudit("receipt_printed_sale_locked", {
      saleId: sale.id,
      receiptNo: sale.receiptNo,
      printedBy: currentUser?.name,
      role: currentUser?.role
    });

    currentReceiptSale = sale;
  }
}

async function savePurchaseExpense(event) {
  event.preventDefault();

  if (!requireRole(["Administrator", "Director"])) {
    showToast("Only Administrator or Director can add expenses.");
    return;
  }

  const expenseDate = normalizeDateInput($("expenseDate").value);
  const category = $("expenseCategory").value;
  const amount = Number($("expenseAmount").value || 0);
  const paymentMethod = $("expensePaymentMethod").value;
  const description = $("expenseDescription").value.trim();

  if (!expenseDate || !category || amount <= 0) {
    showToast("Expense date, category, and amount are required.");
    return;
  }

  await addRecord(STORE.expenses, {
    expenseDate,
    category,
    amount,
    paymentMethod,
    description,
    createdBy: currentUser.id,
    createdByName: currentUser.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await writeAudit("expense_created", {
    category,
    amount,
    expenseDate
  });

  $("expenseForm").reset();
  $("expenseDate").value = formatDateDisplay(new Date().toISOString());

  showToast("Expense saved.");
  await refreshAll();

  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}

async function renderPurchaseExpenses() {
  const expenses = await getAll(STORE.expenses);

  const sorted = expenses.sort((a, b) => {
    const dateA = new Date(toIsoDate(a.expenseDate) || a.createdAt || 0);
    const dateB = new Date(toIsoDate(b.expenseDate) || b.createdAt || 0);
    return dateB - dateA;
  });

  const total = sorted.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  $("purchaseExpensesTotal").textContent = formatMoney(total);

  $("purchaseExpensesTable").innerHTML = sorted.length ? sorted.map(expense => `
    <tr>
      <td>${escapeHtml(formatDateDisplay(expense.expenseDate))}</td>
      <td>${escapeHtml(expense.category)}</td>
      <td>${escapeHtml(expense.description || "")}</td>
      <td>${escapeHtml(expense.paymentMethod || "")}</td>
      <td>${formatMoney(expense.amount)}</td>
      <td>
        ${requireRole(["Administrator", "Director"]) ? `
          <button class="table-btn danger" data-action="delete-expense" data-id="${expense.id}">
            Delete
          </button>
        ` : ""}
      </td>
    </tr>
  `).join("") : `<tr><td colspan="6">No expenses recorded yet.</td></tr>`;
}

async function deletePurchaseExpense(id) {
  if (!requireRole(["Administrator", "Director"])) {
    showToast("Only Administrator or Director can delete expenses.");
    return;
  }

  const expense = await getById(STORE.expenses, id);
  if (!expense) return;

  if (!confirm(`Delete expense ${expense.category} - ${formatMoney(expense.amount)}?`)) {
    return;
  }

  await deleteEverywhere(STORE.expenses, id);

  await writeAudit("expense_deleted", {
    id,
    category: expense.category,
    amount: expense.amount
  });

  showToast("Expense deleted.");
  await refreshAll();

  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}
function bindEvents() {
  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await login($("loginEmail").value.trim(), $("loginPassword").value);
    } catch (error) {
      showToast(error.message);
    }
  });
  const mobileMenuHeader = document.querySelector(".logo-sidebar-card");
  const sidebar = document.querySelector(".sidebar");

  if (mobileMenuHeader && sidebar) {
    mobileMenuHeader.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.toggle("mobile-menu-open");
      }
    });
  }
  $("logoutBtn").addEventListener("click", logout);

  document.querySelectorAll(".nav-link").forEach(button => {
    button.addEventListener("click", () => {
      showPage(button.dataset.page);

      const sidebar = document.querySelector(".sidebar");
      if (window.innerWidth <= 768 && sidebar) {
        sidebar.classList.remove("mobile-menu-open");
      }
    });
  });

  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });

  $("addMedicineBtn")?.addEventListener("click", () => openMedicineForm());
  $("medicineForm")?.addEventListener("submit", saveMedicine);
  $("medicineSearch")?.addEventListener("input", renderInventory);
  $("medicineStatusFilter")?.addEventListener("change", renderInventory);

  $("addSupplierBtn")?.addEventListener("click", () => openSupplierForm());
  $("supplierForm")?.addEventListener("submit", saveSupplier);

  $("addToCartBtn")?.addEventListener("click", addToCart);
  $("completeSaleBtn")?.addEventListener("click", completeSale);
  $("cancelEditSaleBtn")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    resetSaleEditState();
    cart = [];
    $("saleCustomer").value = "";
    renderCart();
  });
  $("clearCartBtn")?.addEventListener("click", () => { cart = []; renderCart(); });
  $("printReceiptBtn").addEventListener("click", async () => {
    await markReceiptAsPrinted();
    printElement("receiptContent", "Sales Receipt");

    if (isDispenser()) {
      showToast("Receipt printed. This sale is now locked.");
    }
  });
  $("printPageBtn")?.addEventListener("click", printOrExportPagePdf);

  $("expenseForm")?.addEventListener("submit", savePurchaseExpense);
  $("addPurchaseLineBtn")?.addEventListener("click", addPurchaseLine);
  $("completePurchaseBtn")?.addEventListener("click", completePurchase);
  $("clearPurchaseBtn").addEventListener("click", () => { purchaseLines = []; renderPurchaseLines(); });

  $("refreshReportsBtn")?.addEventListener("click", renderReports);
  $("reportDate")?.addEventListener("change", renderReports);
  $("exportSalesCsvBtn")?.addEventListener("click", exportSalesCsv);
    const printReportBtn = $("printReportBtn");
    if (printReportBtn) {
      printReportBtn.addEventListener("click", () => {
        printElement("reportPrintable", "Sales Report");
      });
    }
  const exportPurchasesCsvBtn = $("exportPurchasesCsvBtn");
  if (exportPurchasesCsvBtn) {
    exportPurchasesCsvBtn.addEventListener("click", exportPurchasesCsv);
  }

  $("addUserBtn")?.addEventListener("click", () => openUserForm());
  $("userForm")?.addEventListener("submit", saveUser);

  $("exportBackupBtn")?.addEventListener("click", exportBackup);
  $("importBackupInput")?.addEventListener("change", event => importBackup(event.target.files[0]));

  document.querySelectorAll(".sync-now-btn").forEach(button => {
    button.addEventListener("click", () => {
      if (typeof syncNow === "function") {
        syncNow();
      } else {
        showToast("Sync file is not loaded.");
      }
    });
  });

  $("installBtn").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $("installBtn").classList.add("hidden");
  });

  document.body.addEventListener("click", async event => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    const index = Number(target.dataset.index);

    if (action === "edit-medicine") openMedicineForm(id);
    if (action === "delete-medicine") deleteMedicine(id);
    if (action === "edit-sale") editSale(id);
    if (action === "delete-sale") deleteSale(id);
    if (action === "edit-supplier") openSupplierForm(id);
    if (action === "delete-supplier") deleteSupplier(id);
    if (action === "remove-cart") { cart.splice(index, 1); renderCart(); }
    if (action === "remove-purchase-line") { purchaseLines.splice(index, 1); renderPurchaseLines(); }
    if (action === "delete-expense") deletePurchaseExpense(id);
    if (action === "edit-user") openUserForm(id);
    if (action === "delete-user") deleteUser(id);
  });

  const dashMedicineSearch = $("dashMedicineSearch");
  if (dashMedicineSearch) {
    dashMedicineSearch.addEventListener("input", renderDashboardMedicineSearch);
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("installBtn").classList.remove("hidden");
  });
}

async function init() {
  await dbReady;
  await seedInitialData();
  bindEvents();

  attachDateMask("purchaseExpiryDate");
  attachDateMask("reportDate");
  attachDateMask("purchaseDate");
  attachDateMask("expenseDate");

  if ($("reportDate")) {
    $("reportDate").value = todayISO();
  }

  if ($("expenseDate")) {
    $("expenseDate").value = formatDateDisplay(new Date().toISOString());
  }
  const saved = localStorage.getItem(SESSION_KEY);

  if (saved) {
    try {
      currentUser = JSON.parse(saved);

      if (currentUser && currentUser.id && currentUser.role) {
        showApp();
      } else {
        logout();
      }
    } catch {
      logout();
    }
  } else {
    logout();
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init().catch(error => {
  console.error("Startup error:", error);

  const realMessage = error && error.message
    ? error.message
    : String(error);

  const toast = document.getElementById("toast");

  if (typeof showToast === "function" && toast) {
    showToast(realMessage);
  } else {
    alert(realMessage);
  }
});