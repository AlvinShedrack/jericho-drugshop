const DB_NAME = "my_rx_database_v3";
const DB_VERSION = 1;
const STORE_NAMES = ["users", "suppliers", "medicines", "sales", "purchases", "auditLogs"];

let db;
let dbReady = openDatabase();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains("users")) {
        const store = database.createObjectStore("users", { keyPath: "id", autoIncrement: true });
        store.createIndex("email", "email", { unique: true });
        store.createIndex("role", "role", { unique: false });
      }

      if (!database.objectStoreNames.contains("suppliers")) {
        const store = database.createObjectStore("suppliers", { keyPath: "id", autoIncrement: true });
        store.createIndex("name", "name", { unique: false });
      }

      if (!database.objectStoreNames.contains("medicines")) {
        const store = database.createObjectStore("medicines", { keyPath: "id", autoIncrement: true });
        store.createIndex("name", "name", { unique: false });
        store.createIndex("batchNo", "batchNo", { unique: false });
        store.createIndex("supplierId", "supplierId", { unique: false });
        store.createIndex("expiryDate", "expiryDate", { unique: false });
      }

      if (!database.objectStoreNames.contains("sales")) {
        const store = database.createObjectStore("sales", { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("receiptNo", "receiptNo", { unique: true });
      }

      if (!database.objectStoreNames.contains("purchases")) {
        const store = database.createObjectStore("purchases", { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("supplierId", "supplierId", { unique: false });
      }

      if (!database.objectStoreNames.contains("auditLogs")) {
        const store = database.createObjectStore("auditLogs", { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = event => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction([storeName], mode).objectStore(storeName);
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function getById(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).get(Number(id));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function addRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").add(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").put(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").delete(Number(id));
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").clear();
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function bulkPut(storeName, records = []) {
  if (!records.length) return true;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);
    records.forEach(record => store.put(record));
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function exportAllData() {
  const output = {
    exportedAt: new Date().toISOString(),
    app: "Budadiri People's Pharmacy",
    version: "1.0.1",
    data: {}
  };

  for (const storeName of STORE_NAMES) {
    output.data[storeName] = await getAll(storeName);
  }

  return output;
}

async function importAllData(backup) {
  if (!backup || typeof backup !== "object") {
    throw new Error("Invalid backup file.");
  }

  // Supports both new backups: { data: { medicines: [] } }
  // and older backups: { medicines: [] }
  const sourceData = backup.data && typeof backup.data === "object"
    ? backup.data
    : backup;

  const hasAnyStore = STORE_NAMES.some(storeName => Array.isArray(sourceData[storeName]));

  if (!hasAnyStore) {
    throw new Error("Invalid backup file. No supported pharmacy data found.");
  }

  // Clear first to avoid duplicate email / receipt / ID conflicts.
  for (const storeName of STORE_NAMES) {
    await clearStore(storeName);
  }

  // Import stores in safe order.
  const importOrder = ["users", "suppliers", "medicines", "sales", "purchases", "auditLogs"];

  for (const storeName of importOrder) {
    if (Array.isArray(sourceData[storeName])) {
      await bulkPut(storeName, sourceData[storeName]);
    }
  }

  return true;
}
