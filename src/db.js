const DB_NAME = "jericho_pharmacy_db";
const DB_VERSION = 3;

const DB_STORES = [
  "users",
  "suppliers",
  "medicines",
  "batches",
  "sales",
  "purchases",
  "expenses",
  "auditLogs"
];

let db = null;

const dbReady = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = event => {
    db = event.target.result;

    DB_STORES.forEach(storeName => {
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, {
          keyPath: "id",
          autoIncrement: true
        });
      }
    });
  };

  request.onsuccess = event => {
    db = event.target.result;

    db.onversionchange = () => {
      db.close();
      alert("Database updated. Please refresh the app.");
    };

    resolve(db);
  };

  request.onerror = event => {
    console.error("IndexedDB error:", event.target.error);
    reject(event.target.error);
  };

  request.onblocked = () => {
    alert("Please close all other tabs of this app, then refresh.");
  };
});

function getStore(storeName, mode = "readonly") {
  if (!db) {
    throw new Error("Database is not ready.");
  }

  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = getStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function normalizeDbKey(id) {
  const value = String(id);

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  return id;
}

function generateLocalId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function getById(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = getStore(storeName).get(normalizeDbKey(id));

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function addRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const cleanRecord = { ...record };

    if (
      cleanRecord.id === undefined ||
      cleanRecord.id === null ||
      cleanRecord.id === ""
    ) {
      cleanRecord.id = generateLocalId();
    }

    const request = getStore(storeName, "readwrite").add(cleanRecord);

    request.onsuccess = () => resolve(cleanRecord.id);
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = getStore(storeName, "readwrite").delete(normalizeDbKey(id));

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const cleanRecord = { ...record };
    if (cleanRecord.id !== undefined && cleanRecord.id !== null && cleanRecord.id !== "") {
      cleanRecord.id = normalizeDbKey(cleanRecord.id);
    }
    const request = getStore(storeName, "readwrite").put(cleanRecord);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const request = getStore(storeName, "readwrite").clear();

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function exportAllData() {
  await dbReady;
  const data = {};
  for (const storeName of DB_STORES) {
    data[storeName] = await getAll(storeName);
  }
  return {
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    data
  };
}

async function importAllData(backup) {
  await dbReady;
  const payload = backup && backup.data ? backup.data : backup;
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid backup format.");
  }

  for (const storeName of DB_STORES) {
    if (!Array.isArray(payload[storeName])) continue;
    await clearStore(storeName);
    for (const item of payload[storeName]) {
      await putRecord(storeName, item);
    }
  }
  return true;
}
