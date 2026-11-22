const STORE = {
  users: "users",
  suppliers: "suppliers",
  medicines: "medicines",
  sales: "sales",
  purchases: "purchases",
  expenses: "expenses",
  auditLogs: "auditLogs"
};

const SESSION_KEY = "budadiri_pharm_session_user";
let currentUser = null;
let cart = [];
let purchaseLines = [];
let currentReceiptSale = null;
let editingSaleId = null;
let deferredInstallPrompt = null;

const BRAND = {
  name: "Budadiri People's Pharmacy",
  tagline: "Caring passionately for your health and drug needs",
  receiptTagline: "Thank you for choosing Budadiri People's Pharmacy.",
  logo: "./assets/budadiri-logo.png",
  address: "Located at: Wagagai Hotel, Budadiri Town Council",
  phone: "0704-180 237 / 0786-403 301",
  email: ""
};

const pageMeta = {
  dashboard: ["Dashboard", "Business overview and alerts"],
  inventory: ["Inventory", "Medicine catalog and pricing"],
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

function normalizeMedicineId(id) {
  if (id === null || id === undefined || id === "") return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

async function getMedicineById(id) {
  const normalizedId = normalizeMedicineId(id);
  if (normalizedId === null) return null;
  return await getById(STORE.medicines, normalizedId);
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
  if (!dateString) return 999999;

  const isoDate = toIsoDate(dateString);

  if (!isoDate) {
    return 999999;
  }

  const today = new Date(`${todayISO()}T00:00:00`);
  const target = new Date(`${isoDate}T00:00:00`);

  if (Number.isNaN(target.getTime())) {
    return 999999;
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
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
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

function getMedicineBatches(med) {
  if (Array.isArray(med.batches) && med.batches.length) {
    return med.batches;
  }
  const qty = Number(med.quantity || 0);
  if (qty > 0 || med.batchNo || med.expiryDate || med.buyingPrice) {
    return [{
      batchId: `legacy-${med.id}`,
      batchNo: med.batchNo || "DEFAULT",
      expiryDate: med.expiryDate || "",
      quantity: qty,
      unitCost: Number(med.buyingPrice || 0),
      createdAt: med.createdAt || new Date().toISOString()
    }];
  }
  return [];
}

function recalculateMedicineFromBatches(med) {
  const batches = Array.isArray(med.batches) ? med.batches : [];
  const totalQty = batches.reduce((sum, b) => sum + Math.max(0, Number(b.quantity || 0)), 0);
  med.quantity = totalQty;

  const activeBatch = batches.find(b => Number(b.quantity || 0) > 0) || batches.at(-1);
  if (activeBatch) {
    med.batchNo = activeBatch.batchNo || "";
    med.expiryDate = activeBatch.expiryDate || "";
    med.buyingPrice = Number(activeBatch.unitCost ?? med.buyingPrice ?? 0);
  }
}

async function seedInitialData() {
  const users = await getAll(STORE.users);
  if (!users.length) {
    await addRecord(STORE.users, {
      name: "System Administrator",
      email: "patienceannamuduwa@gmail.com",
      passwordHash: simpleHash("Patience@budadiri"),
      role: "Administrator",
      isActive: true,
      createdAt: new Date().toISOString()
    });

    await addRecord(STORE.users, {
      name: "Main Dispenser",
      email: "justus@peoplespharmacy.com",
      passwordHash: simpleHash("Justus@2024"),
      role: "Dispenser",
      isActive: true,
      createdAt: new Date().toISOString()
    });

    await addRecord(STORE.users, {
      name: "Director",
      email: "nangoliumar6@gmail.com",
      passwordHash: simpleHash("Honourable"),
      role: "Director",
      isActive: true,
      createdAt: new Date().toISOString()
    });
  }

  const suppliers = await getAll(STORE.suppliers);
  if (!suppliers.length) {
    await addRecord(STORE.suppliers, {
      name: "Default Supplier",
      phone: "",
      email: "",
      address: "",
      createdAt: new Date().toISOString()
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

  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !manager);
  });

  document.querySelectorAll(".director-only").forEach(el => {
    el.classList.toggle("hidden", !directorOnly);
  });

  document.querySelectorAll(".pharmacist-admin-only").forEach(el => {
    el.classList.toggle("hidden", !manager);
  });

  const saleType = $("saleType");
  if (saleType) {
    saleType.disabled = false;
    Array.from(saleType.options).forEach(option => {
      option.hidden = false;
    });
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

  $(pageId)?.classList.add("active");
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
  if (pageId === "sales") renderSalesHistory();
  if (pageId === "purchases") renderPurchasesHistory();
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;

  window.__lastModalTrigger = document.activeElement;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  window.requestAnimationFrame(() => {
    const firstField = modal.querySelector(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
    );
    firstField?.focus();
  });
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");

  if (!document.querySelector(".modal:not(.hidden)")) {
    document.body.classList.remove("modal-open");
  }

  if (window.__lastModalTrigger && typeof window.__lastModalTrigger.focus === "function") {
    window.__lastModalTrigger.focus();
  }
}

async function renderDashboard() {
  const medicines = await getAll(STORE.medicines);
  const sales = await getAll(STORE.sales);
  const today = todayISO();
  const todaySales = sales.filter(sale => isSameDay(sale.createdAt, today));
  const lowStock = medicines.filter(med => Number(med.quantity || 0) <= Number(med.reorderLevel || 5));
  const expiring = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) >= 0 && daysUntil(med.expiryDate) <= 90);
  const expired = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) < 0);

  const todaySalesTotal = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const todayProfitTotal = todaySales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);
  const stockValue = medicines.reduce((sum, med) => {
    const batches = getMedicineBatches(med);
    if (batches.length) {
      return sum + batches.reduce((bSum, b) => bSum + (Number(b.quantity || 0) * Number(b.unitCost || 0)), 0);
    }
    return sum + (Number(med.quantity || 0) * Number(med.buyingPrice || 0));
  }, 0);

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
    ...expired.slice(0, 5).map(med => ({
      type: "danger",
      title: `${med.name} expired`,
      detail: med.batchNo ? `Batch ${med.batchNo} expired on ${med.expiryDate}` : `Expired on ${med.expiryDate}`
    })),
    ...expiring.slice(0, 5).map(med => ({
      type: "warning",
      title: `${med.name} expiring soon`,
      detail: med.batchNo ? `Batch ${med.batchNo} expires on ${med.expiryDate}` : `Expires on ${med.expiryDate}`
    })),
    ...lowStock.slice(0, 5).map(med => ({
      type: "info",
      title: `${med.name} low stock`,
      detail: `${Number(med.quantity || 0)} left. Reorder level is ${med.reorderLevel || 5}.`
    }))
  ];

  $("alertsList").innerHTML = alerts.length ? alerts.slice(0, 8).map(alert => `
    <div class="alert-item">
      <div><strong>${escapeHtml(alert.title)}</strong><br><span class="muted">${escapeHtml(alert.detail)}</span></div>
      <span class="badge ${alert.type}">${alert.type}</span>
    </div>
  `).join("") : `<div class="warning-box">No priority alerts.</div>`;
}

async function renderSalesHistory() {
  const sales = await getAll(STORE.sales);
  const history = [...sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  $("salesHistoryTable").innerHTML = history.length
    ? history.map(sale => {
      const createdAt = sale.createdAt ? new Date(sale.createdAt).toLocaleString() : "";
      const customerName = escapeHtml(sale.customerName || "Walk-in customer");
      const paymentMethod = escapeHtml(sale.paymentMethod || "Cash");
      const saleType = escapeHtml(sale.saleType || "retail");
      const total = Number(sale.total || 0);
      const amountPaid = Number(sale.amountPaid || 0);
      const changeGiven = Number(sale.changeGiven || Math.max(0, amountPaid - total));
      const linesCount = Array.isArray(sale.lines) ? sale.lines.length : 0;

      return `
        <tr data-id="${sale.id}">
          <td>${escapeHtml(sale.receiptNo || String(sale.id))}</td>
          <td>${customerName}<br><span class="muted">${linesCount} item(s)</span></td>
          <td>${paymentMethod}</td>
          <td>${saleType}</td>
          <td>${formatMoney(total)}</td>
          <td>${formatMoney(amountPaid)}</td>
          <td>${formatMoney(changeGiven)}</td>
          <td>${createdAt}</td>
          <td class="actions-cell">
            <button class="table-btn" data-action="view-receipt" data-id="${sale.id}">Receipt / Reprint</button>
            <button class="table-btn secondary" data-action="edit-sale" data-id="${sale.id}">Edit Items</button>
            <button class="table-btn danger" data-action="delete-sale" data-id="${sale.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="9">No sales recorded yet.</td></tr>`;
}

async function openSaleReceiptById(saleId) {
  const sale = await getById(STORE.sales, saleId);
  if (!sale) return showToast("Sale receipt not found.");
  showReceipt(sale);
}

function recalcEditSaleModalTotals() {
  const rows = document.querySelectorAll("#editSaleLinesTable tr");
  let subtotal = 0;
  let totalDiscount = 0;

  rows.forEach(row => {
    const qty = Math.max(0, Number(row.querySelector('[name="saleLineQty"]')?.value || 0));
    const unitPrice = Math.max(0, Number(row.querySelector('[name="saleLinePrice"]')?.value || 0));
    const lineDiscount = Math.max(0, Number(row.querySelector('[name="saleLineDiscount"]')?.value || 0));
    const lineTotal = Math.max(0, (qty * unitPrice) - lineDiscount);

    subtotal += qty * unitPrice;
    totalDiscount += lineDiscount;

    const totalCell = row.querySelector(".edit-sale-line-total");
    if (totalCell) totalCell.textContent = formatMoney(lineTotal);
  });

  const grandTotal = Math.max(0, subtotal - totalDiscount);
  const amountPaid = Math.max(0, Number($("editSaleAmountPaid")?.value || 0));
  const changeGiven = Math.max(0, amountPaid - grandTotal);

  if ($("editSaleSubtotalDisplay")) $("editSaleSubtotalDisplay").value = formatMoney(subtotal);
  if ($("editSaleDiscountDisplay")) $("editSaleDiscountDisplay").value = formatMoney(totalDiscount);
  if ($("editSaleTotalDisplay")) $("editSaleTotalDisplay").value = formatMoney(grandTotal);
  if ($("editSaleChangeGiven")) $("editSaleChangeGiven").value = changeGiven.toFixed(0);
}

async function populateEditSaleAddMedicineOptions(selectedMedId = null) {
  const medSelect = $("editSaleAddMedicineSelect");
  if (!medSelect) return;

  const medicines = await getAll(STORE.medicines);
  const sellable = medicines
    .filter(med => Number(med.quantity || 0) > 0 && (!med.expiryDate || daysUntil(med.expiryDate) >= 0))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  medSelect.innerHTML = sellable.length
    ? sellable.map(med => `<option value="${med.id}">${escapeHtml(med.name)} | Qty ${Number(med.quantity || 0)} | ${formatMoney(med.sellingPrice)}</option>`).join("")
    : `<option value="">No sellable medicine available</option>`;

  if (selectedMedId && sellable.some(m => Number(m.id) === Number(selectedMedId))) {
    medSelect.value = String(selectedMedId);
  }

  await populateEditSaleAddBatchOptions();
}

async function populateEditSaleAddBatchOptions() {
  const medSelect = $("editSaleAddMedicineSelect");
  const batchSelect = $("editSaleAddBatchSelect");
  if (!medSelect || !batchSelect) return;

  const medId = Number(medSelect.value);
  if (!medId) {
    batchSelect.innerHTML = `<option value="">No batch</option>`;
    return;
  }

  const med = await getMedicineById(medId);
  if (!med) {
    batchSelect.innerHTML = `<option value="">No batch</option>`;
    return;
  }

  const batches = getMedicineBatches(med).filter(b => {
    const notExpired = !b.expiryDate || daysUntil(b.expiryDate) >= 0;
    return Number(b.quantity || 0) > 0 && notExpired;
  });

  if (!batches.length) {
    batchSelect.innerHTML = `<option value="">Auto / General Stock (${Number(med.quantity || 0)})</option>`;
    return;
  }

  batchSelect.innerHTML = batches.map((b, idx) => {
    const label = [
      b.batchNo || `Batch #${idx + 1}`,
      `Qty: ${Number(b.quantity || 0)}`,
      b.expiryDate ? `Exp: ${formatDateDisplay(b.expiryDate)}` : "",
      `Cost: ${formatMoney(b.unitCost || 0)}`
    ].filter(Boolean).join(" | ");
    return `<option value="${escapeHtml(String(b.batchId ?? idx))}">${escapeHtml(label)}</option>`;
  }).join("");
}

function buildEditSaleLineRow(line, idx) {
  const qty = Number(line.qty || 0);
  const price = Number(line.sellingPrice || 0);
  const discount = Number(line.discount || 0);
  const lineTotal = Math.max(0, (qty * price) - discount);
  return `
    <tr
      data-line-index="${idx}"
      data-medicine-id="${escapeHtml(String(line.medicineId || ""))}"
      data-batch-id="${escapeHtml(String(line.batchId || ""))}"
      data-batch-no="${escapeHtml(String(line.batchNo || ""))}"
      data-item-name="${escapeHtml(String(line.name || "Item"))}"
      data-buying-price="${escapeHtml(String(line.buyingPrice ?? 0))}"
    >
      <td><strong>${escapeHtml(line.name || "Item")}</strong></td>
      <td>${escapeHtml(line.batchNo || "-")}</td>
      <td><input class="table-input" type="number" min="0" step="any" name="saleLineQty" value="${qty}" /></td>
      <td><input class="table-input" type="number" min="0" step="any" name="saleLinePrice" value="${price}" /></td>
      <td><input class="table-input" type="number" min="0" step="any" name="saleLineDiscount" value="${discount}" /></td>
      <td class="edit-sale-line-total">${formatMoney(lineTotal)}</td>
      <td><button type="button" class="table-btn danger" data-action="remove-edit-sale-line" data-index="${idx}">Remove</button></td>
    </tr>
  `;
}

async function addItemToEditSaleModal() {
  const medSelect = $("editSaleAddMedicineSelect");
  const batchSelect = $("editSaleAddBatchSelect");
  const tbody = $("editSaleLinesTable");
  if (!medSelect || !tbody) return;

  const medicineId = Number(medSelect.value);
  if (!medicineId) return showToast("Select a medicine to add.");

  const med = await getMedicineById(medicineId);
  if (!med) return showToast("Medicine not found.");
  if (med.expiryDate && daysUntil(med.expiryDate) < 0) return showToast("Cannot add expired medicine.");

  const selectedBatchId = batchSelect?.value || "";
  const batches = getMedicineBatches(med);
  const chosenBatch = batches.find((b, idx) => String(b.batchId ?? idx) === selectedBatchId);

  if (chosenBatch && chosenBatch.expiryDate && daysUntil(chosenBatch.expiryDate) < 0) {
    return showToast("Cannot add from an expired batch.");
  }

  const saleType = $("editSaleType")?.value || "retail";
  const defaultPrice = await getDefaultSalePriceForMedicine(med, saleType);
  const costBasis = chosenBatch ? Number(chosenBatch.unitCost ?? med.buyingPrice ?? 0) : Number(med.buyingPrice || 0);

  if (tbody.querySelector("td[colspan]")) {
    tbody.innerHTML = "";
  }

  const nextIdx = tbody.querySelectorAll("tr").length;
  const newLine = {
    medicineId: normalizeMedicineId(med.id),
    name: med.name,
    batchId: chosenBatch ? String(chosenBatch.batchId || "") : "",
    batchNo: chosenBatch ? (chosenBatch.batchNo || "") : (med.batchNo || ""),
    qty: 1,
    sellingPrice: defaultPrice,
    buyingPrice: costBasis,
    discount: 0
  };

  tbody.insertAdjacentHTML("beforeend", buildEditSaleLineRow(newLine, nextIdx));
  recalcEditSaleModalTotals();
  showToast(`Added ${med.name} to sale.`);
}

async function openEditSaleModal(saleId) {
  const sale = await getById(STORE.sales, saleId);
  if (!sale) return showToast("Sale not found.");

  $("editSaleId").value = sale.id;
  $("editSaleCustomer").value = sale.customerName || "Walk-in customer";
  $("editSalePaymentMethod").value = sale.paymentMethod || "Cash";
  $("editSaleType").value = sale.saleType || "retail";

  const lines = Array.isArray(sale.lines) ? sale.lines : [];
  $("editSaleLinesTable").innerHTML = lines.length
    ? lines.map((line, idx) => buildEditSaleLineRow(line, idx)).join("")
    : `<tr><td colspan="7">No line items recorded on this sale.</td></tr>`;

  await populateEditSaleAddMedicineOptions();

  const computedTotal = lines.reduce((sum, l) => sum + Math.max(0, (Number(l.qty || 0) * Number(l.sellingPrice || 0)) - Number(l.discount || 0)), 0);
  $("editSaleAmountPaid").value = Number(sale.amountPaid ?? computedTotal ?? sale.total ?? 0);

  recalcEditSaleModalTotals();
  openModal("editSaleModal");
}

async function saveEditedSale(event) {
  event.preventDefault();

  const saleId = Number($("editSaleId").value);
  const sale = await getById(STORE.sales, saleId);
  if (!sale) return showToast("Sale not found.");

  const oldLines = Array.isArray(sale.lines) ? sale.lines : [];
  const rows = Array.from(document.querySelectorAll("#editSaleLinesTable tr[data-line-index]"));

  const updatedLines = rows.map(row => {
    const origIndex = Number(row.dataset.lineIndex);
    const orig = oldLines[origIndex] || {};
    return {
      ...orig,
      medicineId: normalizeMedicineId(orig.medicineId ?? row.dataset.medicineId),
      name: orig.name || row.dataset.itemName || "Item",
      batchId: orig.batchId ?? (row.dataset.batchId || ""),
      batchNo: orig.batchNo ?? (row.dataset.batchNo || ""),
      buyingPrice: orig.buyingPrice ?? Number(row.dataset.buyingPrice || 0),
      qty: Math.max(0, Number(row.querySelector('[name="saleLineQty"]')?.value || 0)),
      sellingPrice: Math.max(0, Number(row.querySelector('[name="saleLinePrice"]')?.value || 0)),
      discount: Math.max(0, Number(row.querySelector('[name="saleLineDiscount"]')?.value || 0))
    };
  }).filter(line => Number(line.qty || 0) > 0);

  // Reconcile medicine batch quantities for changed or removed items
  const medDeltaMap = new Map();
  for (const oldLine of oldLines) {
    const oldMedicineId = normalizeMedicineId(oldLine.medicineId);
    if (oldMedicineId === null) continue;
    const key = `${oldMedicineId}::${oldLine.batchId || ""}`;
    const entry = medDeltaMap.get(key) || {
      medicineId: oldMedicineId,
      batchId: oldLine.batchId || "",
      oldQty: 0,
      newQty: 0
    };
    entry.oldQty += Number(oldLine.qty || 0);
    medDeltaMap.set(key, entry);
  }

  for (const newLine of updatedLines) {
    const newMedicineId = normalizeMedicineId(newLine.medicineId);
    if (newMedicineId === null) continue;
    const key = `${newMedicineId}::${newLine.batchId || ""}`;
    const entry = medDeltaMap.get(key) || {
      medicineId: newMedicineId,
      batchId: newLine.batchId || "",
      oldQty: 0,
      newQty: 0
    };
    entry.newQty += Number(newLine.qty || 0);
    medDeltaMap.set(key, entry);
  }

  for (const entry of medDeltaMap.values()) {
    const qtyRestoreOrDeduct = entry.oldQty - entry.newQty; // positive = return to stock, negative = deduct more
    if (qtyRestoreOrDeduct === 0) continue;

    const med = await getMedicineById(entry.medicineId);
    if (!med) continue;

    const batches = [...getMedicineBatches(med).map(b => ({ ...b }))];
    if (entry.batchId) {
      const target = batches.find(b => String(b.batchId) === String(entry.batchId));
      if (target) {
        target.quantity = Math.max(0, Number(target.quantity || 0) + qtyRestoreOrDeduct);
      } else {
        med.quantity = Math.max(0, Number(med.quantity || 0) + qtyRestoreOrDeduct);
      }
    } else if (batches.length) {
      batches[0].quantity = Math.max(0, Number(batches[0].quantity || 0) + qtyRestoreOrDeduct);
    } else {
      med.quantity = Math.max(0, Number(med.quantity || 0) + qtyRestoreOrDeduct);
    }

    med.batches = batches;
    if (batches.length) {
      recalculateMedicineFromBatches(med);
    }
    med.updatedAt = new Date().toISOString();
    await putRecord(STORE.medicines, med);
  }

  const subtotal = updatedLines.reduce((sum, l) => sum + (Number(l.qty || 0) * Number(l.sellingPrice || 0)), 0);
  const discount = updatedLines.reduce((sum, l) => sum + Number(l.discount || 0), 0);
  const total = Math.max(0, subtotal - discount);
  const amountPaid = Math.max(0, Number($("editSaleAmountPaid")?.value || total));
  const changeGiven = Math.max(0, amountPaid - total);
  const profit = updatedLines.reduce((sum, l) => {
    const rev = Math.max(0, (Number(l.qty || 0) * Number(l.sellingPrice || 0)) - Number(l.discount || 0));
    const cost = Number(l.qty || 0) * Number(l.buyingPrice || 0);
    return sum + (rev - cost);
  }, 0);

  sale.customerName = $("editSaleCustomer").value.trim() || "Walk-in customer";
  sale.paymentMethod = $("editSalePaymentMethod").value;
  sale.saleType = $("editSaleType").value;
  sale.lines = updatedLines;
  sale.subtotal = subtotal;
  sale.discount = discount;
  sale.total = total;
  sale.amountPaid = amountPaid;
  sale.changeGiven = changeGiven;
  sale.profit = profit;
  sale.updatedAt = new Date().toISOString();

  await putRecord(STORE.sales, sale);
  await writeAudit("sale_updated", { saleId, receiptNo: sale.receiptNo, total });

  closeModal("editSaleModal");
  showToast("Sale and items updated.");
  await refreshAll();
  await renderSalesHistory();
  if (typeof queueAutoSync === "function") queueAutoSync();
}

async function deleteSaleRecord(saleId) {
  if (!confirm("Delete this sale record? This cannot be undone.")) return;

  await deleteRecord(STORE.sales, saleId);
  editingSaleId = null;
  showToast("Sale record deleted.");
  await refreshAll();
  renderSalesHistory();

  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}

async function renderInventory() {
  const medicines = await getAll(STORE.medicines);
  const search = ($("medicineSearch")?.value || "").toLowerCase().trim();
  const filter = $("medicineStatusFilter")?.value || "all";

  let filtered = medicines.filter(med => {
    const haystack = `${med.name || ""} ${med.genericName || ""} ${med.category || ""}`.toLowerCase();
    return haystack.includes(search);
  });

  filtered = filtered.filter(med => {
    const d = daysUntil(med.expiryDate);
    const isLow = Number(med.quantity || 0) <= Number(med.reorderLevel || 5);
    if (filter === "low") return isLow;
    if (filter === "expiring") return med.expiryDate && d >= 0 && d <= 90;
    if (filter === "expired") return med.expiryDate && d < 0;
    return true;
  });

  filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const canEdit = requireRole(["Administrator", "Director"]);

  $("medicineTable").innerHTML = filtered.length ? filtered.map(med => {
    const activeBatches = getMedicineBatches(med).filter(b => Number(b.quantity || 0) > 0);
    const batchHint = activeBatches.length
      ? `<br><span class="muted">${activeBatches.length} batch(es) | Total Qty: ${Number(med.quantity || 0)}</span>`
      : `<br><span class="muted">Qty: ${Number(med.quantity || 0)}</span>`;

    return `
      <tr>
        <td><strong>${escapeHtml(med.name)}</strong><br><span class="muted">${escapeHtml(med.genericName || "")}</span>${batchHint}</td>
        <td>${escapeHtml(med.category || "")}</td>
        <td>${formatMoney(med.buyingPrice)}</td>
        <td>${formatMoney(med.sellingPrice)}</td>
        <td>${formatMoney(med.wholesalePrice)}</td>
        <td>
          ${canEdit ? `<button class="table-btn" data-action="edit-medicine" data-id="${med.id}">Edit</button>` : ""}
          ${canEdit ? `<button class="table-btn danger" data-action="delete-medicine" data-id="${med.id}">Delete</button>` : ""}
        </td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="6">No medicines found.</td></tr>`;
}

async function populateSupplierOptions() {
  const suppliers = await getAll(STORE.suppliers);
  const options = suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if ($("medicineSupplier")) {
    $("medicineSupplier").innerHTML = `<option value="">Not set</option>${options}`;
  }
  if ($("purchaseSupplierSelect")) {
    $("purchaseSupplierSelect").innerHTML = options || `<option value="">Add supplier first</option>`;
  }
}

async function getDefaultSalePriceForMedicine(med, saleType) {
  if (!med) return 0;
  const baseSelling = Number(med.sellingPrice || 0);
  if (saleType === "wholesale") {
    return med.wholesalePrice ? Number(med.wholesalePrice) : Math.round(baseSelling * 0.9);
  }
  return baseSelling;
}

async function syncSalePriceInputFromSelection() {
  const priceInput = $("salePrice");
  const select = $("saleMedicineSelect");
  if (!priceInput || !select) return;

  const medicineId = Number(select.value);
  if (!medicineId) {
    priceInput.value = "";
    return;
  }

  const med = await getMedicineById(medicineId);
  if (!med) return;

  const saleType = $("saleType")?.value || "retail";
  const price = await getDefaultSalePriceForMedicine(med, saleType);
  priceInput.value = price;
}

async function populateBatchOptionsForMedicine() {
  const medSelect = $("saleMedicineSelect");
  const batchSelect = $("saleBatchSelect");
  if (!medSelect || !batchSelect) return;

  const medId = Number(medSelect.value);
  if (!medId) {
    batchSelect.innerHTML = `<option value="">No batch</option>`;
    return;
  }

  const med = await getMedicineById(medId);
  if (!med) {
    batchSelect.innerHTML = `<option value="">No batch</option>`;
    return;
  }

  const batches = getMedicineBatches(med).filter(b => {
    const notExpired = !b.expiryDate || daysUntil(b.expiryDate) >= 0;
    return Number(b.quantity || 0) > 0 && notExpired;
  });

  if (!batches.length) {
    batchSelect.innerHTML = `<option value="">Auto / General Stock (${Number(med.quantity || 0)})</option>`;
    return;
  }

  batchSelect.innerHTML = batches.map((b, idx) => {
    const label = [
      b.batchNo || `Batch #${idx + 1}`,
      `Qty: ${Number(b.quantity || 0)}`,
      b.expiryDate ? `Exp: ${formatDateDisplay(b.expiryDate)}` : "",
      `Cost: ${formatMoney(b.unitCost || 0)}`
    ].filter(Boolean).join(" | ");
    return `<option value="${escapeHtml(String(b.batchId ?? idx))}">${escapeHtml(label)}</option>`;
  }).join("");
}

async function populateMedicineOptions() {
  const medicines = await getAll(STORE.medicines);
  const saleList = medicines
    .filter(med => Number(med.quantity || 0) > 0 && (!med.expiryDate || daysUntil(med.expiryDate) >= 0))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const saleOptions = saleList
    .map(med => `<option value="${med.id}">${escapeHtml(med.name)} | Qty ${Number(med.quantity || 0)} | ${formatMoney(med.sellingPrice)}${med.wholesalePrice ? ` | Wholesale ${formatMoney(med.wholesalePrice)}` : ""}</option>`)
    .join("");

  const purchaseOptions = medicines
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .map(med => `<option value="${med.id}">${escapeHtml(med.name)}</option>`)
    .join("");

  $("saleMedicineSelect").innerHTML = saleOptions || `<option value="">No sellable medicine available</option>`;
  $("purchaseMedicineSelect").innerHTML = purchaseOptions || `<option value="">Add medicine first</option>`;

  await populateBatchOptionsForMedicine();
  await syncSalePriceInputFromSelection();
}

async function openMedicineForm(id = null) {
  await populateSupplierOptions();
  $("medicineForm").reset();
  $("medicineId").value = "";
  $("reorderLevel").value = 5;

  if (id) {
    const med = await getMedicineById(id);
    if (!med) return;
    $("medicineModalTitle").textContent = "Edit Medicine";
    $("medicineId").value = med.id;
    $("medicineName").value = med.name || "";
    $("genericName").value = med.genericName || "";
    $("category").value = med.category || "";
    $("buyingPrice").value = med.buyingPrice || 0;
    $("sellingPrice").value = med.sellingPrice || 0;
    $("wholesalePrice").value = med.wholesalePrice || 0;
    $("reorderLevel").value = med.reorderLevel || 5;
    $("medicineNotes").value = med.notes || "";
  } else {
    $("medicineModalTitle").textContent = "Add Medicine";
  }

  openModal("medicineModal");
}

async function saveMedicine(event) {
  event.preventDefault();

  if (!requireRole(["Administrator", "Director"])) {
    showToast("Only Admin or Director can save medicines.");
    return;
  }

  const id = $("medicineId").value;
  const existing = id ? await getMedicineById(id) : null;
  const record = {
    ...(existing || {}),
    name: $("medicineName").value.trim(),
    genericName: $("genericName").value.trim(),
    category: $("category").value.trim(),
    quantity: existing ? Number(existing.quantity || 0) : 0,
    buyingPrice: Number($("buyingPrice").value || 0),
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
  const med = await getMedicineById(id);
  if (!med) return;
  if (!confirm(`Delete ${med.name}?`)) return;
  await deleteRecord(STORE.medicines, id);
  await writeAudit("medicine_deleted", { id, name: med.name });
  showToast("Medicine deleted.");
  await refreshAll();
  if (typeof queueAutoSync === "function") {
    queueAutoSync();
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

  const filtered = medicines
    .filter(med => {
      const text = `${med.name || ""} ${med.genericName || ""} ${med.category || ""}`.toLowerCase();
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
      <div>Wholesale: ${formatMoney(med.wholesalePrice)}</div>
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
  await deleteRecord(STORE.suppliers, id);
  await writeAudit("supplier_deleted", { id, name: supplier.name });
  showToast("Supplier deleted.");
  await refreshAll();
  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}

async function addToCart() {
  const medicineId = Number($("saleMedicineSelect").value);
  const selectedBatchId = $("saleBatchSelect")?.value || "";
  const qty = Number($("saleQty").value || 0);
  const discount = Number($("saleDiscount").value || 0);
  const rawPriceInput = $("salePrice")?.value;

  if (!medicineId || qty <= 0) return showToast("Select medicine and quantity.");

  const med = await getMedicineById(medicineId);
  if (!med) return showToast("Medicine not found.");
  if (med.expiryDate && daysUntil(med.expiryDate) < 0) return showToast("Cannot sell expired medicine.");

  const batches = getMedicineBatches(med);
  const chosenBatch = batches.find((b, idx) => String(b.batchId ?? idx) === selectedBatchId);

  if (chosenBatch && chosenBatch.expiryDate && daysUntil(chosenBatch.expiryDate) < 0) {
    return showToast("Cannot sell from an expired batch.");
  }

  const availableQty = chosenBatch ? Number(chosenBatch.quantity || 0) : Number(med.quantity || 0);
  const existingQtyInCart = cart
    .filter(item => Number(item.medicineId) === Number(medicineId) && String(item.batchId || "") === String(chosenBatch?.batchId || ""))
    .reduce((sum, item) => sum + Number(item.qty || 0), 0);

  if (existingQtyInCart + qty > availableQty) {
    return showToast(`Insufficient stock in selected batch (${availableQty} available).`);
  }

  const saleType = $("saleType")?.value || "retail";
  const defaultPrice = await getDefaultSalePriceForMedicine(med, saleType);
  const parsedPrice = rawPriceInput !== undefined && rawPriceInput !== "" ? Number(rawPriceInput) : defaultPrice;
  const effectivePrice = Number.isNaN(parsedPrice) || parsedPrice < 0 ? defaultPrice : parsedPrice;
  const costBasis = chosenBatch ? Number(chosenBatch.unitCost ?? med.buyingPrice ?? 0) : Number(med.buyingPrice || 0);

  cart.push({
    medicineId: normalizeMedicineId(medicineId),
    name: med.name,
    batchId: chosenBatch ? String(chosenBatch.batchId || "") : "",
    batchNo: chosenBatch ? (chosenBatch.batchNo || "") : (med.batchNo || ""),
    qty,
    sellingPrice: effectivePrice,
    buyingPrice: costBasis,
    discount: Math.max(0, discount),
    saleType
  });

  $("saleQty").value = "";
  $("saleDiscount").value = "";
  renderCart();
}

function updateCartItemPrice(index, newPrice) {
  const item = cart[index];
  if (!item) return;
  const parsed = Number(newPrice);
  item.sellingPrice = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  renderCart();
}

function renderCart() {
  $("cartTable").innerHTML = cart.length ? cart.map((item, index) => {
    const subtotal = item.qty * item.sellingPrice;
    const total = Math.max(0, subtotal - item.discount);
    return `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong>${item.batchNo ? `<br><span class="muted">Batch ${escapeHtml(item.batchNo)}</span>` : ""}</td>
        <td>${item.qty}</td>
        <td>
          <input
            type="number"
            class="table-input cart-price-input"
            data-cart-price-index="${index}"
            min="0"
            step="any"
            value="${Number(item.sellingPrice || 0)}"
          />
        </td>
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

async function completeSale() {
  if (!cart.length) return showToast("Cart is empty.");

  const medicines = await getAll(STORE.medicines);
  for (const item of cart) {
    const med = medicines.find(m => Number(m.id) === Number(item.medicineId));
    if (!med) return showToast(`Medicine not found for ${item.name}.`);

    const batches = getMedicineBatches(med);
    if (item.batchId) {
      const batch = batches.find(b => String(b.batchId) === String(item.batchId));
      const neededForBatch = cart
        .filter(c => Number(c.medicineId) === Number(med.id) && String(c.batchId) === String(item.batchId))
        .reduce((s, c) => s + Number(c.qty || 0), 0);
      if (!batch || Number(batch.quantity || 0) < neededForBatch) {
        return showToast(`Insufficient stock in batch ${item.batchNo || ""} for ${item.name}.`);
      }
    } else if (Number(med.quantity || 0) < Number(item.qty)) {
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

  const medMap = new Map();
  for (const item of cart) {
    let med = medMap.get(normalizeMedicineId(item.medicineId)) || await getMedicineById(item.medicineId);
    let batches = [...getMedicineBatches(med).map(b => ({ ...b }))];
    let remainingToDeduct = Number(item.qty || 0);

    if (item.batchId) {
      const target = batches.find(b => String(b.batchId) === String(item.batchId));
      if (target) {
        const take = Math.min(Number(target.quantity || 0), remainingToDeduct);
        target.quantity = Number(target.quantity || 0) - take;
        remainingToDeduct -= take;
      }
    }

    if (remainingToDeduct > 0) {
      for (const b of batches) {
        if (remainingToDeduct <= 0) break;
        const take = Math.min(Number(b.quantity || 0), remainingToDeduct);
        b.quantity = Number(b.quantity || 0) - take;
        remainingToDeduct -= take;
      }
    }

    med.batches = batches;
    if (batches.length) {
      recalculateMedicineFromBatches(med);
    } else {
      med.quantity = Math.max(0, Number(med.quantity || 0) - Number(item.qty || 0));
    }
    med.updatedAt = new Date().toISOString();
    medMap.set(normalizeMedicineId(item.medicineId), med);
  }

  for (const med of medMap.values()) {
    await putRecord(STORE.medicines, med);
  }

  const saleType = $("saleType")?.value || "retail";

  const sale = {
    receiptNo: `BPP-${Date.now()}`,
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
    createdAt: new Date().toISOString()
  };

  const saleId = await addRecord(STORE.sales, sale);
  const savedSale = { ...sale, id: saleId };
  await writeAudit("sale_completed", { receiptNo: sale.receiptNo, total, amountPaid, changeGiven });

  showReceipt(savedSale);
  cart = [];
  $("saleCustomer").value = "";
  renderCart();
  showToast(`Sale completed. Change: ${formatMoney(changeGiven)}`);
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
              <td>${escapeHtml(item.name)}${item.batchNo ? `<br><span class="muted">Batch: ${escapeHtml(item.batchNo)}</span>` : ""}</td>
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
      <td>${escapeHtml(item.batchNo || "")}</td>
      <td>${escapeHtml(item.expiryDate || "")}</td>
      <td>${item.qty}</td>
      <td>${formatMoney(item.unitCost)}</td>
      <td>${formatMoney(item.qty * item.unitCost)}</td>
      <td><button class="table-btn danger" data-action="remove-purchase-line" data-index="${index}">Remove</button></td>
    </tr>
  `).join("") : `<tr><td colspan="7">No purchase lines.</td></tr>`;

  const total = purchaseLines.reduce((sum, item) => sum + (item.qty * item.unitCost), 0);
  $("purchaseTotal").textContent = formatMoney(total);
}

async function addPurchaseLine() {
  if (!requireRole(["Administrator", "Director"])) return showToast("Only Admin or Director can add purchases.");

  const medicineId = Number($("purchaseMedicineSelect").value);
  const batchNo = ($("purchaseBatch")?.value || "").trim();
  const expiryDate = normalizeDateInput(($("purchaseExpiry")?.value || "").trim());
  const qty = Number($("purchaseQty").value || 0);
  const unitCost = Number($("purchaseCost").value || 0);

  if (!medicineId || qty <= 0 || unitCost < 0) return showToast("Select medicine, quantity, and unit cost.");

  const med = await getMedicineById(medicineId);
  if (!med) return showToast("Medicine not found.");

  purchaseLines.push({
    medicineId: normalizeMedicineId(medicineId),
    name: med.name,
    batchNo,
    expiryDate,
    qty,
    unitCost
  });

  if ($("purchaseBatch")) $("purchaseBatch").value = "";
  if ($("purchaseExpiry")) $("purchaseExpiry").value = "";
  $("purchaseQty").value = "";
  $("purchaseCost").value = "";
  renderPurchaseLines();
}

async function completePurchase() {
  if (!requireRole(["Administrator", "Director"])) return showToast("Not allowed.");
  if (!purchaseLines.length) return showToast("No purchase lines.");

  const supplierId = Number($("purchaseSupplierSelect").value) || null;
  const invoiceNo = $("purchaseInvoice").value.trim() || `PINV-${Date.now()}`;
  const purchaseDate = normalizeDateInput($("purchaseDate").value || formatDateDisplay(new Date().toISOString()));
  const total = purchaseLines.reduce((sum, item) => sum + (item.qty * item.unitCost), 0);

  for (const line of purchaseLines) {
    const med = await getMedicineById(line.medicineId);
    if (!med) continue;

    const batches = Array.isArray(med.batches) ? [...med.batches] : getMedicineBatches(med);
    const normalizedBatchNo = (line.batchNo || "").trim();
    const normalizedExpiry = line.expiryDate || "";
    const unitCost = Number(line.unitCost || 0);
    const qty = Number(line.qty || 0);

    const matchingBatch = normalizedBatchNo
      ? batches.find(b =>
        String(b.batchNo || "").trim().toLowerCase() === normalizedBatchNo.toLowerCase() &&
        String(b.expiryDate || "") === normalizedExpiry &&
        Number(b.unitCost || 0) === unitCost
      )
      : null;

    if (matchingBatch) {
      matchingBatch.quantity = Number(matchingBatch.quantity || 0) + qty;
      matchingBatch.updatedAt = new Date().toISOString();
    } else {
      batches.push({
        batchId: `B-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        batchNo: normalizedBatchNo || `BATCH-${batches.length + 1}`,
        expiryDate: normalizedExpiry,
        quantity: qty,
        unitCost,
        invoiceNo,
        supplierId,
        purchaseDate,
        createdAt: new Date().toISOString()
      });
    }

    med.batches = batches;
    recalculateMedicineFromBatches(med);
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
  showToast("Purchase saved as batch stock.");
  await refreshAll();
  if (typeof queueAutoSync === "function") {
    queueAutoSync();
  }
}

async function renderPurchasesHistory() {
  const table = $("purchasesHistoryTable");
  if (!table) return;

  const purchases = await getAll(STORE.purchases);
  const suppliers = await getAll(STORE.suppliers);
  const canEdit = requireRole(["Administrator", "Director"]);

  const sorted = [...purchases].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  table.innerHTML = sorted.length ? sorted.map(purchase => {
    const itemsSummary = Array.isArray(purchase.lines) && purchase.lines.length
      ? purchase.lines.map(l => {
        const meta = [
          l.batchNo ? `Batch ${l.batchNo}` : "",
          l.expiryDate ? `Exp ${l.expiryDate}` : "",
          l.unitCost !== undefined ? `@ ${formatMoney(l.unitCost)}` : ""
        ].filter(Boolean).join(", ");
        return `${escapeHtml(l.name)} (${l.qty})${meta ? ` <span class="muted">[${escapeHtml(meta)}]</span>` : ""}`;
      }).join("<br>")
      : `<span class="muted">No lines</span>`;

    return `
      <tr>
        <td><strong>${escapeHtml(purchase.invoiceNo || "")}</strong></td>
        <td>${escapeHtml(supplierName(suppliers, purchase.supplierId))}</td>
        <td>${escapeHtml(formatDateDisplay(purchase.purchaseDate || purchase.createdAt))}</td>
        <td>${itemsSummary}</td>
        <td>${formatMoney(purchase.total)}</td>
        <td>${escapeHtml(purchase.createdByName || "")}</td>
        <td class="actions-cell">
          <button class="table-btn" data-action="view-purchase" data-id="${purchase.id}">View</button>
          ${canEdit ? `<button class="table-btn secondary" data-action="edit-purchase" data-id="${purchase.id}">Edit</button>` : ""}
          ${canEdit ? `<button class="table-btn danger" data-action="delete-purchase" data-id="${purchase.id}">Delete</button>` : ""}
        </td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="7">No purchases recorded yet.</td></tr>`;
}

async function openPurchaseInvoiceView(id) {
  const purchase = await getById(STORE.purchases, id);
  if (!purchase) return showToast("Invoice not found.");
  const suppliers = await getAll(STORE.suppliers);

  const lines = Array.isArray(purchase.lines) ? purchase.lines : [];
  const total = Number(
    purchase.total ?? lines.reduce((sum, l) => sum + (Number(l.qty || 0) * Number(l.unitCost || 0)), 0)
  );
  const purchaseDateStr = purchase.purchaseDate || purchase.createdAt || "";

  $("invoiceViewModalTitle").textContent = `Purchase Receipt: ${purchase.invoiceNo || id}`;
  $("invoiceViewContent").innerHTML = `
    <div id="printableInvoiceSheet" class="receipt-content">
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

        <div class="receipt-title">Purchase Receipt</div>

        <div class="receipt-meta-grid">
          <div>
            <strong>Invoice No.:</strong>
            <span>${escapeHtml(purchase.invoiceNo || String(purchase.id))}</span>
          </div>

          <div>
            <strong>Recorded By:</strong>
            <span>${escapeHtml(purchase.createdByName || currentUser?.name || "")}</span>
          </div>

          <div>
            <strong>Date:</strong>
            <span>${escapeHtml(formatDateDisplay(purchaseDateStr))}</span>
          </div>

          <div>
            <strong>Items Count:</strong>
            <span>${lines.length}</span>
          </div>

          <div>
            <strong>Time:</strong>
            <span>${purchase.createdAt ? new Date(purchase.createdAt).toLocaleTimeString() : ""}</span>
          </div>

          <div>
            <strong>Supplier:</strong>
            <span>${escapeHtml(supplierName(suppliers, purchase.supplierId))}</span>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit Cost</th>
              <th>Total</th>
            </tr>
          </thead>

          <tbody>
            ${lines.map((item, index) => {
              const qty = Number(item.qty || 0);
              const cost = Number(item.unitCost || 0);
              const details = [
                item.batchNo ? `Batch: ${item.batchNo}` : "",
                item.expiryDate ? `Exp: ${item.expiryDate}` : ""
              ].filter(Boolean).join(" | ");
              return `
                <tr>
                  <td>${index + 1}</td>
                  <td>${escapeHtml(item.name)}${details ? `<br><span class="muted">${escapeHtml(details)}</span>` : ""}</td>
                  <td>${qty}</td>
                  <td>${formatMoney(cost)}</td>
                  <td>${formatMoney(qty * cost)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>

        <div class="receipt-total-box">
          <div class="receipt-total-line">
            <span>Line Items</span>
            <strong>${lines.length}</strong>
          </div>

          <div class="receipt-total-line grand">
            <span>Invoice Total</span>
            <strong>${formatMoney(total)}</strong>
          </div>
        </div>

        <div class="receipt-footer-note">
          ${BRAND.receiptTagline}
          <span>${BRAND.address}</span>
        </div>
      </div>
    </div>
  `;
  openModal("invoiceViewModal");
}

function recalcEditPurchaseTotal() {
  const rows = document.querySelectorAll("#editPurchaseLinesTable tr");
  let sum = 0;
  rows.forEach(row => {
    const qty = Number(row.querySelector('[name="lineQty"]')?.value || 0);
    const cost = Number(row.querySelector('[name="lineCost"]')?.value || 0);
    const lineTotal = Math.max(0, qty) * Math.max(0, cost);
    sum += lineTotal;
    const cell = row.querySelector(".edit-line-total");
    if (cell) cell.textContent = formatMoney(lineTotal);
  });
  if ($("editPurchaseTotal")) $("editPurchaseTotal").textContent = formatMoney(sum);
}

async function openEditPurchaseModal(id) {
  if (!requireRole(["Administrator", "Director"])) return showToast("Not allowed.");
  const purchase = await getById(STORE.purchases, id);
  if (!purchase) return showToast("Purchase invoice not found.");

  const suppliers = await getAll(STORE.suppliers);
  $("editPurchaseSupplier").innerHTML =
    `<option value="">Not set</option>` +
    suppliers.map(s => `<option value="${s.id}" ${Number(s.id) === Number(purchase.supplierId) ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");

  $("editPurchaseId").value = purchase.id;
  $("editPurchaseInvoiceNo").value = purchase.invoiceNo || "";
  $("editPurchaseDate").value = formatDateDisplay(purchase.purchaseDate || purchase.createdAt);

  const lines = Array.isArray(purchase.lines) ? purchase.lines : [];
  $("editPurchaseLinesTable").innerHTML = lines.map((line, idx) => {
    const qty = Number(line.qty || 0);
    const cost = Number(line.unitCost || 0);
    return `
      <tr data-line-index="${idx}">
        <td><strong>${escapeHtml(line.name)}</strong></td>
        <td><input class="table-input" name="lineBatch" value="${escapeHtml(line.batchNo || "")}" /></td>
        <td><input class="table-input" name="lineExpiry" value="${escapeHtml(line.expiryDate || "")}" placeholder="DD-MM-YYYY" /></td>
        <td><input class="table-input" type="number" min="0" name="lineQty" value="${qty}" /></td>
        <td><input class="table-input" type="number" min="0" step="any" name="lineCost" value="${cost}" /></td>
        <td class="edit-line-total">${formatMoney(qty * cost)}</td>
      </tr>
    `;
  }).join("");

  recalcEditPurchaseTotal();
  openModal("editPurchaseModal");
}

async function saveEditedPurchase(event) {
  event.preventDefault();
  if (!requireRole(["Administrator", "Director"])) return showToast("Not allowed.");

  const id = Number($("editPurchaseId").value);
  const purchase = await getById(STORE.purchases, id);
  if (!purchase) return showToast("Invoice not found.");

  const oldLines = Array.isArray(purchase.lines) ? purchase.lines : [];
  const rows = Array.from(document.querySelectorAll("#editPurchaseLinesTable tr"));

  const updatedLines = rows.map((row, idx) => {
    const orig = oldLines[idx] || {};
    return {
      ...orig,
      batchNo: row.querySelector('[name="lineBatch"]').value.trim(),
      expiryDate: normalizeDateInput(row.querySelector('[name="lineExpiry"]').value.trim()),
      qty: Math.max(0, Number(row.querySelector('[name="lineQty"]').value || 0)),
      unitCost: Math.max(0, Number(row.querySelector('[name="lineCost"]').value || 0))
    };
  });

  for (let i = 0; i < Math.max(oldLines.length, updatedLines.length); i++) {
    const oldL = oldLines[i];
    const newL = updatedLines[i];
    const medId = normalizeMedicineId(newL?.medicineId ?? oldL?.medicineId);
    if (!medId) continue;

    const med = await getMedicineById(medId);
    if (!med) continue;

    const batches = Array.isArray(med.batches) ? [...med.batches] : getMedicineBatches(med);
    const oldQty = Number(oldL?.qty || 0);
    const newQty = Number(newL?.qty || 0);
    const delta = newQty - oldQty;

    const targetBatch = batches.find(b =>
      (oldL?.batchNo && String(b.batchNo || "") === String(oldL.batchNo) && Number(b.unitCost || 0) === Number(oldL.unitCost || 0)) ||
      (newL?.batchNo && String(b.batchNo || "") === String(newL.batchNo))
    );

    if (targetBatch) {
      targetBatch.quantity = Math.max(0, Number(targetBatch.quantity || 0) + delta);
      if (newL?.batchNo) targetBatch.batchNo = newL.batchNo;
      if (newL?.expiryDate) targetBatch.expiryDate = newL.expiryDate;
      if (newL !== undefined) targetBatch.unitCost = Number(newL.unitCost || 0);
    } else if (newQty > 0) {
      batches.push({
        batchId: `B-${Date.now()}-${i}`,
        batchNo: newL.batchNo || `BATCH-${batches.length + 1}`,
        expiryDate: newL.expiryDate || "",
        quantity: newQty,
        unitCost: Number(newL.unitCost || 0),
        invoiceNo: $("editPurchaseInvoiceNo").value.trim(),
        createdAt: new Date().toISOString()
      });
    }

    med.batches = batches;
    recalculateMedicineFromBatches(med);
    med.updatedAt = new Date().toISOString();
    await putRecord(STORE.medicines, med);
  }

  purchase.supplierId = Number($("editPurchaseSupplier").value) || null;
  purchase.invoiceNo = $("editPurchaseInvoiceNo").value.trim() || purchase.invoiceNo;
  purchase.purchaseDate = normalizeDateInput($("editPurchaseDate").value) || purchase.purchaseDate;
  purchase.lines = updatedLines;
  purchase.total = updatedLines.reduce((sum, l) => sum + (Number(l.qty || 0) * Number(l.unitCost || 0)), 0);
  purchase.updatedAt = new Date().toISOString();

  await putRecord(STORE.purchases, purchase);
  await writeAudit("purchase_updated", { id, invoiceNo: purchase.invoiceNo, total: purchase.total });

  closeModal("editPurchaseModal");
  showToast("Purchase invoice updated.");
  await refreshAll();
  if (typeof queueAutoSync === "function") queueAutoSync();
}

async function deletePurchaseRecord(id) {
  if (!requireRole(["Administrator", "Director"])) return showToast("Not allowed.");
  const purchase = await getById(STORE.purchases, id);
  if (!purchase) return;
  if (!confirm(`Delete purchase invoice ${purchase.invoiceNo || id}?`)) return;

  await deleteRecord(STORE.purchases, id);
  await writeAudit("purchase_deleted", { id, invoiceNo: purchase.invoiceNo });
  showToast("Purchase deleted.");
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
  const lowStock = medicines.filter(med => Number(med.quantity || 0) <= Number(med.reorderLevel || 5));
  const expired = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) < 0);
  const expiring = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) >= 0 && daysUntil(med.expiryDate) <= 90);

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
    if (med.expiryDate && d < 0) { status = "Expired"; badge = "danger"; }
    else if (med.expiryDate && d <= 90) { status = "Expiring"; badge = "warning"; }
    if (Number(med.quantity || 0) <= Number(med.reorderLevel || 5)) {
      status += status === "OK" ? "Low stock" : " + Low stock";
      if (badge !== "danger") badge = "warning";
    }
    return `
      <tr>
        <td>${escapeHtml(med.name)}</td>
        <td>${Number(med.quantity || 0)}</td>
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
  const rows = [["Invoice", "Supplier", "Purchase Date", "Total Cost", "Created By", "Created By Name", "Date"]];
  purchases.forEach(purchase => {
    const supplier = suppliers.find(s => Number(s.id) === Number(purchase.supplierId));
    rows.push([
      purchase.invoiceNo,
      supplier ? supplier.name : "Unknown",
      purchase.purchaseDate || "",
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
  await deleteRecord(STORE.users, id);
  await writeAudit("user_deleted", { id, email: user.email });
  showToast("User deleted.");
  await refreshAll();
  if (typeof queueAutoSync === "function") {
    queueAutoSync();
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
      * { box-sizing: border-box; }
      body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.45; }
      .report-page { position: relative; width: 100%; max-width: 1120px; margin: 0 auto; background: #ffffff; padding: 28px; overflow: hidden; }
      .report-watermark { position: absolute; width: 42%; max-width: 420px; opacity: 0.045; top: 48%; left: 50%; transform: translate(-50%, -50%); z-index: 0; pointer-events: none; }
      .report-page > *:not(.report-watermark) { position: relative; z-index: 1; }
      .report-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 3px solid #0057b8; padding-bottom: 16px; margin-bottom: 22px; }
      .brand { display: flex; align-items: center; gap: 12px; }
      .brand-logo-img { width: 58px; height: 58px; object-fit: contain; border-radius: 12px; background: #ffffff; }
      .brand h1 { margin: 0; font-size: 20px; letter-spacing: -0.02em; color: #0057b8; text-transform: uppercase; }
      .brand p { margin: 3px 0 0; color: #0b8f2a; font-weight: 700; }
      .report-meta { text-align: right; color: #334155; font-size: 11px; border: 1px solid #bfdbfe; border-radius: 10px; padding: 10px; background: #f8fbff; }
      .report-title { margin-bottom: 18px; }
      .report-title h2 { margin: 0 0 4px; font-size: 22px; color: #0057b8; text-transform: uppercase; }
      .report-title p { margin: 0; color: #64748b; }
      .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0 22px; }
      .summary-card { border: 1px solid #bfdbfe; border-left: 4px solid #0057b8; padding: 11px 12px; background: rgba(248, 251, 255, 0.92); border-radius: 10px; }
      .summary-card span { display: block; color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em; }
      .summary-card strong { display: block; margin-top: 5px; font-size: 16px; color: #0057b8; }
      .section { margin-top: 20px; page-break-inside: avoid; }
      .section h3 { margin: 0 0 8px; font-size: 15px; color: #0057b8; border-bottom: 1px solid #bfdbfe; padding-bottom: 6px; text-transform: uppercase; }
      .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0 16px; }
      .info-box { border: 1px solid #e2e8f0; padding: 9px; background: rgba(248, 250, 252, 0.92); border-radius: 8px; }
      .info-box span { display: block; color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 700; }
      .info-box strong { display: block; margin-top: 4px; color: #0f172a; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: auto; background: rgba(255, 255, 255, 0.92); }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      th { background: #0057b8; color: #ffffff; text-align: left; padding: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; border: 1px solid #0057b8; }
      td { padding: 8px; border: 1px solid #bfdbfe; vertical-align: top; }
      tbody tr:nth-child(even) { background: rgba(248, 251, 255, 0.75); }
      .text-right { text-align: right; }
      .status { font-weight: 700; }
      .status-danger { color: #b91c1c; }
      .status-warning { color: #b45309; }
      .status-success { color: #15803d; }
      .empty-box { border: 1px dashed #cbd5e1; background: rgba(248, 250, 252, 0.92); padding: 14px; color: #64748b; border-radius: 8px; }
      .totals-box { width: 320px; margin-left: auto; margin-top: 14px; border: 1px solid #bfdbfe; background: rgba(255, 255, 255, 0.92); }
      .total-line { display: flex; justify-content: space-between; gap: 12px; padding: 9px 11px; border-bottom: 1px solid #e2e8f0; }
      .total-line:last-child { border-bottom: none; font-weight: 800; font-size: 14px; background: #eaf3ff; color: #0057b8; }
      .approval-box { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 26px; }
      .approval-box div { border: 1px solid #bfdbfe; padding: 12px; border-radius: 10px; }
      .approval-line { display: block; border-bottom: 1px solid #0f172a; height: 24px; margin-top: 10px; }
      .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #bfdbfe; color: #64748b; font-size: 10px; display: flex; justify-content: space-between; gap: 18px; }
      @media print {
        body { background: #ffffff; }
        .report-page { max-width: none; padding: 0; }
        a[href]::after { content: "" !important; }
        @page { size: A4 portrait; margin: 12mm; }
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
          <div><strong>Approved By:</strong><span class="approval-line"></span></div>
          <div><strong>Date:</strong><span class="approval-line"></span></div>
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
  return `<div class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function infoBox(label, value) {
  return `<div class="info-box"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function makeTable(headers, rows, emptyMessage = "No records found.") {
  if (!rows.length) {
    return `<div class="empty-box">${escapeHtml(emptyMessage)}</div>`;
  }
  return `
    <table>
      <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

function medicineStatus(med) {
  const d = daysUntil(med.expiryDate);
  const isLow = Number(med.quantity || 0) <= Number(med.reorderLevel || 5);
  const isExpired = Boolean(med.expiryDate) && d < 0;
  const isExpiring = Boolean(med.expiryDate) && d >= 0 && d <= 90;

  if (isExpired && isLow) return { label: "Expired + Low Stock", className: "status-danger" };
  if (isExpired) return { label: "Expired", className: "status-danger" };
  if (isExpiring && isLow) return { label: "Expiring Soon + Low Stock", className: "status-warning" };
  if (isExpiring) return { label: "Expiring Soon", className: "status-warning" };
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
  const lowStock = medicines.filter(med => Number(med.quantity || 0) <= Number(med.reorderLevel || 5));
  const expiring = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) >= 0 && daysUntil(med.expiryDate) <= 90);
  const expired = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) < 0);

  const todaySalesTotal = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const todayProfitTotal = todaySales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);
  const stockValue = medicines.reduce((sum, med) => {
    const batches = getMedicineBatches(med);
    if (batches.length) {
      return sum + batches.reduce((bSum, b) => bSum + (Number(b.quantity || 0) * Number(b.unitCost || 0)), 0);
    }
    return sum + (Number(med.quantity || 0) * Number(med.buyingPrice || 0));
  }, 0);

  const recentSales = [...sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 15);
  const alerts = [
    ...expired.map(med => ({ medicine: med.name, detail: `Expired on ${med.expiryDate}`, status: "Expired" })),
    ...expiring.map(med => ({ medicine: med.name, detail: `Expires on ${med.expiryDate}`, status: "Expiring Soon" })),
    ...lowStock.map(med => ({ medicine: med.name, detail: `${Number(med.quantity || 0)} left. Reorder level is ${med.reorderLevel || 5}`, status: "Low Stock" }))
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
        ["Medicine", "Alert", "Status"],
        alerts.map(alert => `
          <tr>
            <td>${escapeHtml(alert.medicine)}</td>
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
  const search = ($("medicineSearch")?.value || "").toLowerCase().trim();
  const filter = $("medicineStatusFilter")?.value || "all";

  let filtered = medicines.filter(med => {
    const haystack = `${med.name || ""} ${med.genericName || ""} ${med.category || ""}`.toLowerCase();
    return haystack.includes(search);
  });

  filtered = filtered.filter(med => {
    const d = daysUntil(med.expiryDate);
    const isLow = Number(med.quantity || 0) <= Number(med.reorderLevel || 5);
    if (filter === "low") return isLow;
    if (filter === "expiring") return med.expiryDate && d >= 0 && d <= 90;
    if (filter === "expired") return med.expiryDate && d < 0;
    return true;
  });

  filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const body = `
    <div class="summary-grid">
      ${summaryCard("Filtered Medicines", filtered.length)}
      ${summaryCard("Search Applied", search || "None")}
      ${summaryCard("Filter Applied", filter)}
      ${summaryCard("Generated", todayISO())}
    </div>
    <section class="section">
      <h3>Medicine Inventory Listing</h3>
      ${makeTable(
        ["Medicine", "Generic", "Category", "Buy", "Sell", "Wholesale"],
        filtered.map(med => `
          <tr>
            <td>${escapeHtml(med.name)}</td>
            <td>${escapeHtml(med.genericName || "")}</td>
            <td>${escapeHtml(med.category || "")}</td>
            <td class="text-right">${formatMoney(med.buyingPrice)}</td>
            <td class="text-right">${formatMoney(med.sellingPrice)}</td>
            <td class="text-right">${formatMoney(med.wholesalePrice)}</td>
          </tr>
        `),
        "No medicines match the selected filters."
      )}
    </section>
  `;

  return reportShell("Inventory Report", "Medicine catalog and pricing listing.", body);
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
  const recentPurchases = [...purchases].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 15);

  const body = `
    <div class="info-grid">
      ${infoBox("Supplier", supplier ? supplier.name : "Not selected")}
      ${infoBox("Invoice Number", invoiceNo)}
      ${infoBox("Current Draft Total", formatMoney(currentTotal))}
    </div>
    <section class="section">
      <h3>Current Purchase Lines</h3>
      ${makeTable(
        ["Medicine", "Batch", "Expiry", "Qty", "Unit Cost", "Line Total"],
        purchaseLines.map(item => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.batchNo || "")}</td>
            <td>${escapeHtml(item.expiryDate || "")}</td>
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
  const lowStock = medicines.filter(med => Number(med.quantity || 0) <= Number(med.reorderLevel || 5));
  const expired = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) < 0);
  const expiring = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) >= 0 && daysUntil(med.expiryDate) <= 90);
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
        ["Medicine", "Qty", "Reorder Level", "Expiry", "Status"],
        alerts.map(med => {
          const status = medicineStatus(med);
          return `
            <tr>
              <td>${escapeHtml(med.name)}</td>
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
    return reportShell("Users Report", "Access restricted.", `<div class="empty-box">Only Admin users can print the Users & Roles report.</div>`);
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

  return reportShell("My Rx Report", "Professional printable report.", `<div class="empty-box">No printable report is configured for this page.</div>`);
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

async function exportBackup() {
  const backup = await exportAllData();
  downloadFile(`my-rx-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2));
  await writeAudit("backup_exported", {});
  showToast("Backup exported.");
}

async function importBackup(file) {
  if (!file) return;

  const confirmed = confirm("Importing this backup will replace the current data on this device. Continue?");
  if (!confirmed) {
    $("importBackupInput").value = "";
    return;
  }

  try {
    const text = await file.text();
    if (!text.trim()) throw new Error("Backup file is empty.");
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
  await renderDashboardMedicineSearch();
  renderCart();
  renderPurchaseLines();
  await renderPurchasesHistory();
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
          @page { size: A4; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body { padding: 10mm !important; font-family: Arial, sans-serif; }
          .no-print, button { display: none !important; }
          a[href]::after { content: "" !important; }
          .panel, .receipt-content { box-shadow: none !important; border: none !important; }
          .table-wrap { overflow: visible !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
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

  await writeAudit("expense_created", { category, amount, expenseDate });
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
          <button class="table-btn danger" data-action="delete-expense" data-id="${expense.id}">Delete</button>
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

  await deleteRecord(STORE.expenses, id);
  await writeAudit("expense_deleted", { id, category: expense.category, amount: expense.amount });
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
      const sb = document.querySelector(".sidebar");
      if (window.innerWidth <= 768 && sb) {
        sb.classList.remove("mobile-menu-open");
      }
    });
  });

  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });

  document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", event => {
      if (event.target === modal) {
        closeModal(modal.id);
      }
    });
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const openModals = Array.from(document.querySelectorAll(".modal:not(.hidden)"));
    const activeModal = openModals.at(-1);
    if (activeModal) {
      closeModal(activeModal.id);
    }
  });

  $("addMedicineBtn").addEventListener("click", () => openMedicineForm());
  $("medicineForm").addEventListener("submit", saveMedicine);
  $("medicineSearch").addEventListener("input", renderInventory);
  $("medicineStatusFilter").addEventListener("change", renderInventory);

  $("addSupplierBtn").addEventListener("click", () => openSupplierForm());
  $("supplierForm").addEventListener("submit", saveSupplier);

  $("saleMedicineSelect")?.addEventListener("change", async () => {
    await populateBatchOptionsForMedicine();
    await syncSalePriceInputFromSelection();
  });
  $("saleType")?.addEventListener("change", syncSalePriceInputFromSelection);

  $("cartTable")?.addEventListener("change", event => {
    const input = event.target.closest(".cart-price-input");
    if (!input) return;
    updateCartItemPrice(Number(input.dataset.cartPriceIndex), input.value);
  });

  $("addToCartBtn").addEventListener("click", addToCart);
  $("completeSaleBtn").addEventListener("click", completeSale);
  $("clearCartBtn").addEventListener("click", () => { cart = []; renderCart(); });

  $("printReceiptBtn").addEventListener("click", async () => {
    await markReceiptAsPrinted();
    printElement("receiptContent", "Sales Receipt");
    if (isDispenser()) {
      showToast("Receipt printed. This sale is now locked.");
    }
  });
  $("printPageBtn")?.addEventListener("click", printOrExportPagePdf);

  $("expenseForm").addEventListener("submit", savePurchaseExpense);
  $("addPurchaseLineBtn").addEventListener("click", addPurchaseLine);
  $("completePurchaseBtn").addEventListener("click", completePurchase);
  $("clearPurchaseBtn").addEventListener("click", () => { purchaseLines = []; renderPurchaseLines(); });
  $("refreshPurchasesHistoryBtn")?.addEventListener("click", renderPurchasesHistory);
  $("editPurchaseForm")?.addEventListener("submit", saveEditedPurchase);
  $("editPurchaseLinesTable")?.addEventListener("input", recalcEditPurchaseTotal);
  $("editSaleForm")?.addEventListener("submit", saveEditedSale);
  $("editSaleLinesTable")?.addEventListener("input", recalcEditSaleModalTotals);
  $("editSaleAmountPaid")?.addEventListener("input", recalcEditSaleModalTotals);
  $("editSaleAddMedicineSelect")?.addEventListener("change", populateEditSaleAddBatchOptions);
  $("editSaleAddItemBtn")?.addEventListener("click", addItemToEditSaleModal);
  $("printInvoiceModalBtn")?.addEventListener("click", () => printElement("printableInvoiceSheet", "Purchase Invoice"));

  $("refreshReportsBtn").addEventListener("click", renderReports);
  $("reportDate").addEventListener("change", renderReports);
  $("exportSalesCsvBtn").addEventListener("click", exportSalesCsv);

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

  $("addUserBtn").addEventListener("click", () => openUserForm());
  $("userForm").addEventListener("submit", saveUser);

  $("exportBackupBtn").addEventListener("click", exportBackup);
  $("importBackupInput").addEventListener("change", event => importBackup(event.target.files[0]));

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
    if (action === "edit-supplier") openSupplierForm(id);
    if (action === "delete-supplier") deleteSupplier(id);
    if (action === "view-receipt") await openSaleReceiptById(Number(id));
    if (action === "edit-sale") await openEditSaleModal(Number(id));
    if (action === "remove-edit-sale-line") {
      const row = target.closest("tr");
      if (row) row.remove();
      recalcEditSaleModalTotals();
    }
    if (action === "delete-sale") await deleteSaleRecord(Number(id));
    if (action === "remove-cart") { cart.splice(index, 1); renderCart(); }
    if (action === "remove-purchase-line") { purchaseLines.splice(index, 1); renderPurchaseLines(); }
    if (action === "view-purchase") await openPurchaseInvoiceView(Number(id));
    if (action === "edit-purchase") await openEditPurchaseModal(Number(id));
    if (action === "delete-purchase") await deletePurchaseRecord(Number(id));
    if (action === "delete-expense") deletePurchaseExpense(id);
    if (action === "edit-user") openUserForm(id);
    if (action === "delete-user") deleteUser(id);
  });

  const dashMedicineSearch = $("dashMedicineSearch");
  if (dashMedicineSearch) {
    dashMedicineSearch.addEventListener("input", renderDashboardMedicineSearch);
  }

  $("refreshSalesHistoryBtn").addEventListener("click", renderSalesHistory);

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

  attachDateMask("purchaseExpiry");
  attachDateMask("reportDate");
  attachDateMask("purchaseDate");
  attachDateMask("expenseDate");
  attachDateMask("editPurchaseDate");

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
  const realMessage = error && error.message ? error.message : String(error);
  const toast = document.getElementById("toast");
  if (typeof showToast === "function" && toast) {
    showToast(realMessage);
  } else {
    alert(realMessage);
  }
});
