const STORE = {
  users: "users",
  suppliers: "suppliers",
  medicines: "medicines",
  sales: "sales",
  purchases: "purchases",
  auditLogs: "auditLogs"
};

const SESSION_KEY = "my_rx_session_user";
let currentUser = null;
let cart = [];
let purchaseLines = [];
let deferredInstallPrompt = null;

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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isSameDay(isoDate, dateString) {
  return String(isoDate || "").slice(0, 10) === dateString;
}

function daysUntil(dateString) {
  const today = new Date(todayISO());
  const target = new Date(dateString);
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
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function requireRole(roles) {
  return currentUser && roles.includes(currentUser.role);
}

function supplierName(suppliers, id) {
  const supplier = suppliers.find(item => Number(item.id) === Number(id));
  return supplier ? supplier.name : "Not set";
}

async function seedInitialData() {
  const users = await getAll(STORE.users);
  if (!users.length) {
    await addRecord(STORE.users, {
      name: "System Admin",
      email: "admin@example.com",
      passwordHash: simpleHash("admin123"),
      role: "Admin",
      isActive: true,
      createdAt: new Date().toISOString()
    });
    await addRecord(STORE.users, {
      name: "Demo Pharmacist",
      email: "pharmacist@example.com",
      passwordHash: simpleHash("pharm123"),
      role: "Pharmacist",
      isActive: true,
      createdAt: new Date().toISOString()
    });
    await addRecord(STORE.users, {
      name: "Demo Cashier",
      email: "cashier@example.com",
      passwordHash: simpleHash("cashier123"),
      role: "Cashier",
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
  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
}

function showApp() {
  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("currentUserText").innerHTML = `<strong>${escapeHtml(currentUser.name)}</strong><br>${escapeHtml(currentUser.role)}`;
  applyRoleAccess();
  showPage("dashboard");
  refreshAll();
}

function applyRoleAccess() {
  const isAdmin = currentUser?.role === "Admin";
  const isPharmacistOrAdmin = ["Admin", "Pharmacist"].includes(currentUser?.role);

  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !isAdmin);
  });

  document.querySelectorAll(".pharmacist-admin-only").forEach(el => {
    el.classList.toggle("hidden", !isPharmacistOrAdmin);
  });
}

function showPage(pageId) {
  if (pageId === "users" && !requireRole(["Admin"])) {
    showToast("Only Admin can open Users.");
    return;
  }

  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach(link => link.classList.remove("active"));

  $(pageId).classList.add("active");
  document.querySelector(`.nav-link[data-page="${pageId}"]`)?.classList.add("active");

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
  const search = $("medicineSearch").value.toLowerCase().trim();
  const filter = $("medicineStatusFilter").value;

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
    const canEdit = requireRole(["Admin", "Pharmacist"]);
    return `
      <tr>
        <td><strong>${escapeHtml(med.name)}</strong><br><span class="muted">${escapeHtml(med.genericName || "")}</span></td>
        <td>${escapeHtml(med.batchNo)}</td>
        <td>${escapeHtml(med.category || "")}</td>
        <td>${escapeHtml(supplierName(suppliers, med.supplierId))}</td>
        <td><span class="badge ${stockBadge}">${Number(med.quantity || 0)}</span></td>
        <td>${formatMoney(med.buyingPrice)}</td>
        <td>${formatMoney(med.sellingPrice)}</td>
        <td>${formatMoney(med.wholesalePrice)}</td>
        <td><span class="badge ${expiryBadge}">${escapeHtml(med.expiryDate)}</span></td>
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
  $("medicineSupplier").innerHTML = `<option value="">Not set</option>${options}`;
  $("purchaseSupplierSelect").innerHTML = suppliers.length ? options : `<option value="">Add supplier first</option>`;
}

async function populateMedicineOptions() {
  const medicines = await getAll(STORE.medicines);
  const saleOptions = medicines
    .filter(med => Number(med.quantity) > 0 && daysUntil(med.expiryDate) >= 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(med => `<option value="${med.id}">${escapeHtml(med.name)} | Qty ${med.quantity} | ${formatMoney(med.sellingPrice)}${med.wholesalePrice ? ` | Wholesale ${formatMoney(med.wholesalePrice)}` : ""}</option>`).join("");

  const purchaseOptions = medicines
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(med => `<option value="${med.id}">${escapeHtml(med.name)} | Batch ${escapeHtml(med.batchNo)}</option>`).join("");

  $("saleMedicineSelect").innerHTML = saleOptions || `<option value="">No sellable medicine available</option>`;
  $("purchaseMedicineSelect").innerHTML = purchaseOptions || `<option value="">Add medicine first</option>`;
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
    $("batchNo").value = med.batchNo || "";
    $("medicineSupplier").value = med.supplierId || "";
    $("quantity").value = med.quantity || 0;
    $("buyingPrice").value = med.buyingPrice || 0;
    $("sellingPrice").value = med.sellingPrice || 0;
    $("wholesalePrice").value = med.wholesalePrice || 0;
    $("reorderLevel").value = med.reorderLevel || 5;
    $("expiryDate").value = med.expiryDate || "";
    $("medicineNotes").value = med.notes || "";
  } else {
    $("medicineModalTitle").textContent = "Add Medicine";
  }

  openModal("medicineModal");
}

async function saveMedicine(event) {
  event.preventDefault();

  if (!requireRole(["Admin", "Pharmacist"])) {
    showToast("Only Admin or Pharmacist can save medicines.");
    return;
  }

  const id = $("medicineId").value;
  const existing = id ? await getById(STORE.medicines, id) : null;
  const record = {
    ...(existing || {}),
    name: $("medicineName").value.trim(),
    genericName: $("genericName").value.trim(),
    category: $("category").value.trim(),
    batchNo: $("batchNo").value.trim(),
    supplierId: $("medicineSupplier").value ? Number($("medicineSupplier").value) : null,
    quantity: Number($("quantity").value || 0),
    buyingPrice: Number($("buyingPrice").value || 0),
    sellingPrice: Number($("sellingPrice").value || 0),
    wholesalePrice: Number($("wholesalePrice").value || 0),
    reorderLevel: Number($("reorderLevel").value || 5),
    expiryDate: $("expiryDate").value,
    notes: $("medicineNotes").value.trim(),
    updatedAt: new Date().toISOString()
  };

  if (!record.name || !record.batchNo || !record.expiryDate) {
    showToast("Medicine name, batch, and expiry date are required.");
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
}

async function deleteMedicine(id) {
  if (!requireRole(["Admin", "Pharmacist"])) return showToast("Not allowed.");
  const med = await getById(STORE.medicines, id);
  if (!med) return;
  if (!confirm(`Delete ${med.name}?`)) return;
  await deleteRecord(STORE.medicines, id);
  await writeAudit("medicine_deleted", { id, name: med.name });
  showToast("Medicine deleted.");
  await refreshAll();
}

async function renderSuppliers() {
  const suppliers = await getAll(STORE.suppliers);
  const canEdit = requireRole(["Admin", "Pharmacist"]);

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

async function saveSupplier(event) {
  event.preventDefault();
  if (!requireRole(["Admin", "Pharmacist"])) return showToast("Not allowed.");

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
}

async function deleteSupplier(id) {
  if (!requireRole(["Admin", "Pharmacist"])) return showToast("Not allowed.");
  const supplier = await getById(STORE.suppliers, id);
  if (!supplier) return;
  if (!confirm(`Delete supplier ${supplier.name}?`)) return;
  await deleteRecord(STORE.suppliers, id);
  await writeAudit("supplier_deleted", { id, name: supplier.name });
  showToast("Supplier deleted.");
  await refreshAll();
}

async function addToCart() {
  const medicineId = Number($("saleMedicineSelect").value);
  const qty = Number($("saleQty").value || 0);
  const discount = Number($("saleDiscount").value || 0);

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

  $("saleQty").value = 1;
  $("saleDiscount").value = 0;
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
  const sale = {
    receiptNo: `RX-${Date.now()}`,
    customerName: $("saleCustomer").value.trim() || "Walk-in customer",
    paymentMethod: $("salePaymentMethod").value,
    saleType,
    cashierId: currentUser.id,
    cashierName: currentUser.name,
    subtotal,
    discount,
    total,
    profit,
    lines: cart.map(item => ({ ...item })),
    createdAt: new Date().toISOString()
  };

  const saleId = await addRecord(STORE.sales, sale);
  const savedSale = { ...sale, id: saleId };
  await writeAudit("sale_completed", { receiptNo: sale.receiptNo, total });

  showReceipt(savedSale);
  cart = [];
  $("saleCustomer").value = "";
  renderCart();
  showToast("Sale completed.");
  await refreshAll();
}

function showReceipt(sale) {
  $("receiptContent").innerHTML = `
    <h2>My Rx Pharmacy</h2>
    <p>Official Sales Receipt</p>
    <p><strong>${escapeHtml(sale.receiptNo)}</strong></p>
    <p>${new Date(sale.createdAt).toLocaleString()}</p>
    <p>Customer: ${escapeHtml(sale.customerName)}</p>
    <p>Cashier: ${escapeHtml(sale.cashierName)}</p>
    <p>Payment: ${escapeHtml(sale.paymentMethod)}</p>
    <p>Sale type: <strong>${escapeHtml(sale.saleType || "retail").toUpperCase()}</strong></p>
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead>
      <tbody>
        ${sale.lines.map(item => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${item.qty}</td>
            <td>${formatMoney((item.qty * item.sellingPrice) - item.discount)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="receipt-total"><span>Total</span><span>${formatMoney(sale.total)}</span></div>
    <p style="margin-top:16px">Thank you for your business.</p>
  `;
  openModal("receiptModal");
}

function renderPurchaseLines() {
  $("purchaseLinesTable").innerHTML = purchaseLines.length ? purchaseLines.map((item, index) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><br><span class="muted">Batch ${escapeHtml(item.batchNo)}</span></td>
      <td>${item.qty}</td>
      <td>${formatMoney(item.unitCost)}</td>
      <td>${formatMoney(item.qty * item.unitCost)}</td>
      <td><button class="table-btn danger" data-action="remove-purchase-line" data-index="${index}">Remove</button></td>
    </tr>
  `).join("") : `<tr><td colspan="5">No purchase lines.</td></tr>`;

  const total = purchaseLines.reduce((sum, item) => sum + (item.qty * item.unitCost), 0);
  $("purchaseTotal").textContent = formatMoney(total);
}

async function addPurchaseLine() {
  if (!requireRole(["Admin", "Pharmacist"])) return showToast("Only Admin or Pharmacist can add purchases.");

  const medicineId = Number($("purchaseMedicineSelect").value);
  const qty = Number($("purchaseQty").value || 0);
  const unitCost = Number($("purchaseCost").value || 0);

  if (!medicineId || qty <= 0 || unitCost < 0) return showToast("Select medicine, quantity, and unit cost.");

  const med = await getById(STORE.medicines, medicineId);
  if (!med) return showToast("Medicine not found.");

  purchaseLines.push({
    medicineId,
    name: med.name,
    batchNo: med.batchNo,
    qty,
    unitCost
  });

  $("purchaseQty").value = 1;
  $("purchaseCost").value = 0;
  renderPurchaseLines();
}

async function completePurchase() {
  if (!requireRole(["Admin", "Pharmacist"])) return showToast("Not allowed.");
  if (!purchaseLines.length) return showToast("No purchase lines.");

  const supplierId = Number($("purchaseSupplierSelect").value);
  const invoiceNo = $("purchaseInvoice").value.trim() || `PINV-${Date.now()}`;
  const total = purchaseLines.reduce((sum, item) => sum + (item.qty * item.unitCost), 0);

  for (const line of purchaseLines) {
    const med = await getById(STORE.medicines, line.medicineId);
    if (!med) continue;
    med.quantity = Number(med.quantity || 0) + Number(line.qty);
    med.buyingPrice = Number(line.unitCost || med.buyingPrice || 0);
    med.updatedAt = new Date().toISOString();
    await putRecord(STORE.medicines, med);
  }

  await addRecord(STORE.purchases, {
    supplierId,
    invoiceNo,
    total,
    lines: purchaseLines.map(line => ({ ...line })),
    createdBy: currentUser.id,
    createdByName: currentUser.name,
    createdAt: new Date().toISOString()
  });

  await writeAudit("purchase_saved", { invoiceNo, total });
  purchaseLines = [];
  $("purchaseInvoice").value = "";
  renderPurchaseLines();
  showToast("Purchase saved and stock updated.");
  await refreshAll();
}

async function renderReports() {
  const reportDate = $("reportDate").value || todayISO();
  $("reportDate").value = reportDate;

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
        <td>${escapeHtml(med.expiryDate)}</td>
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
  if (!requireRole(["Admin"])) return;
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
  if (!requireRole(["Admin"])) return showToast("Only Admin can manage users.");
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
  if (!requireRole(["Admin"])) return showToast("Only Admin can save users.");

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
}

async function deleteUser(id) {
  if (!requireRole(["Admin"])) return showToast("Only Admin can delete users.");
  if (Number(id) === Number(currentUser.id)) return showToast("You cannot delete your own user while logged in.");

  const user = await getById(STORE.users, id);
  if (!user) return;
  if (!confirm(`Delete user ${user.name}?`)) return;
  await deleteRecord(STORE.users, id);
  await writeAudit("user_deleted", { id, email: user.email });
  showToast("User deleted.");
  await refreshAll();
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

async function printOrExportPdf() {
  const receiptCard = document.querySelector('#receiptModal .receipt-card');
  const filename = `my-rx-receipt-${todayISO()}-${Date.now()}.pdf`;

  if (window.electronAPI?.savePdf) {
    const result = await window.electronAPI.savePdf(filename);
    if (!result?.canceled) showToast('Receipt exported as PDF.');
    return;
  }

  const element = receiptCard.cloneNode(true);
  element.style.padding = '20px';
  const opt = {
    margin: 10,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, allowTaint: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  await html2pdf().set(opt).from(element).save();
  showToast('Receipt exported as PDF.');
}

async function printOrExportPagePdf() {
  const activePage = document.querySelector('.page.active');
  if (!activePage) return showToast('No page to print.');
  const pageId = activePage.id || 'page';
  const filename = `my-rx-${pageId}-${todayISO()}.pdf`;

  if (window.electronAPI?.savePdf) {
    const result = await window.electronAPI.savePdf(filename);
    if (!result?.canceled) showToast('Page exported as PDF.');
    return;
  }

  const element = activePage.cloneNode(true);
  element.style.padding = '20px';
  element.style.backgroundColor = 'white';
  element.style.color = '#0f172a';
  const opt = {
    margin: 10,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, allowTaint: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  await html2pdf().set(opt).from(element).save();
  showToast('Page exported as PDF.');
}

async function exportBackup() {
  const backup = await exportAllData();
  downloadFile(`my-rx-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2));
  await writeAudit("backup_exported", {});
  showToast("Backup exported.");
}

async function importBackup(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    await importAllData(backup);
    await writeAudit("backup_imported", { filename: file.name });
    showToast("Backup imported successfully.");
    await refreshAll();
  } catch (error) {
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
  renderCart();
  renderPurchaseLines();
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

  $("logoutBtn").addEventListener("click", logout);

  document.querySelectorAll(".nav-link").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });

  $("addMedicineBtn").addEventListener("click", () => openMedicineForm());
  $("medicineForm").addEventListener("submit", saveMedicine);
  $("medicineSearch").addEventListener("input", renderInventory);
  $("medicineStatusFilter").addEventListener("change", renderInventory);

  $("addSupplierBtn").addEventListener("click", () => openSupplierForm());
  $("supplierForm").addEventListener("submit", saveSupplier);

  $("addToCartBtn").addEventListener("click", addToCart);
  $("completeSaleBtn").addEventListener("click", completeSale);
  $("clearCartBtn").addEventListener("click", () => { cart = []; renderCart(); });
  $("printReceiptBtn").addEventListener("click", printOrExportPdf);
  $("printPageBtn").addEventListener("click", printOrExportPagePdf);

  $("addPurchaseLineBtn").addEventListener("click", addPurchaseLine);
  $("completePurchaseBtn").addEventListener("click", completePurchase);
  $("clearPurchaseBtn").addEventListener("click", () => { purchaseLines = []; renderPurchaseLines(); });

  $("refreshReportsBtn").addEventListener("click", renderReports);
  $("reportDate").addEventListener("change", renderReports);
  $("exportSalesCsvBtn").addEventListener("click", exportSalesCsv);
  $("exportPurchasesCsvBtn").addEventListener("click", exportPurchasesCsv);

  $("addUserBtn").addEventListener("click", () => openUserForm());
  $("userForm").addEventListener("submit", saveUser);

  $("exportBackupBtn").addEventListener("click", exportBackup);
  $("importBackupInput").addEventListener("change", event => importBackup(event.target.files[0]));

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
    if (action === "remove-cart") { cart.splice(index, 1); renderCart(); }
    if (action === "remove-purchase-line") { purchaseLines.splice(index, 1); renderPurchaseLines(); }
    if (action === "edit-user") openUserForm(id);
    if (action === "delete-user") deleteUser(id);
  });

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

  $("reportDate").value = todayISO();

  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      showApp();
    } catch {
      logout();
    }
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init().catch(error => {
  console.error(error);
  showToast("App failed to start. Check console.");
});
