console.log("SYNC.JS LOADED OK - MANUAL SYNC ONLY");

const JERICHO_SUPABASE_URL = "https://rorqfxjnupdnqzcozeut.supabase.co";
const JERICHO_SUPABASE_PUBLIC_KEY = "sb_publishable_ZCCvcvPKoSDuY4JpRgwghw_Wt35MjBx";

if (!window.supabase) {
  alert("Supabase library is not loaded. Check script order and internet connection.");
  throw new Error("Supabase library is not loaded.");
}

const JERICHO_SYNC_TABLE = "jericho_records";

const JERICHO_SYNC_STORES = [
  "users",
  "suppliers",
  "medicines",
  "sales",
  "purchases",
  "expenses",
  "auditLogs"
];

const JERICHO_DEVICE_ID_KEY = "jericho_device_id";
const JERICHO_LAST_SYNC_KEY = "jericho_last_supabase_sync_at";
const JERICHO_LOCAL_CHANGES_KEY = "jericho_manual_has_changes_v1";
const JERICHO_DIRTY_RECORDS_KEY = "jericho_manual_dirty_records_v1";
const JERICHO_PENDING_DELETES_KEY = "jericho_manual_pending_deletes_v1";

window.__jerichoSyncBusy = false;
window.__jerichoAutoSyncReady = false;
window.__jerichoApplyingRemote = false;
window.__jerichoSuppressWriteTracking = false;

function getJerichoCloud() {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase library is not loaded correctly.");
  }

  if (!window.cloudClient || typeof window.cloudClient.from !== "function") {
    window.cloudClient = window.supabase.createClient(
      JERICHO_SUPABASE_URL,
      JERICHO_SUPABASE_PUBLIC_KEY
    );
  }

  return window.cloudClient;
}

function getJerichoDeviceId() {
  let deviceId = localStorage.getItem(JERICHO_DEVICE_ID_KEY);

  if (!deviceId) {
    deviceId = crypto.randomUUID
      ? crypto.randomUUID()
      : "device_" + Date.now() + "_" + Math.random().toString(16).slice(2);

    localStorage.setItem(JERICHO_DEVICE_ID_KEY, deviceId);
  }

  return deviceId;
}

const jerichoDeviceId = getJerichoDeviceId();

function markLocalChanges() {
  localStorage.setItem(JERICHO_LOCAL_CHANGES_KEY, "true");
}

function clearLocalChanges() {
  localStorage.removeItem(JERICHO_LOCAL_CHANGES_KEY);
}

function hasLocalChanges() {
  return localStorage.getItem(JERICHO_LOCAL_CHANGES_KEY) === "true";
}

function getJsonArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveJsonArray(key, value) {
  localStorage.setItem(key, JSON.stringify(value || []));
}

function getJsonObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
}

function saveJsonObject(key, value) {
  localStorage.setItem(key, JSON.stringify(value || {}));
}

function getDirtyMap() {
  return getJsonObject(JERICHO_DIRTY_RECORDS_KEY);
}

function saveDirtyMap(map) {
  saveJsonObject(JERICHO_DIRTY_RECORDS_KEY, map);
}

function clearDirtyMap() {
  localStorage.removeItem(JERICHO_DIRTY_RECORDS_KEY);
}

function getPendingDeletes() {
  return getJsonArray(JERICHO_PENDING_DELETES_KEY);
}

function savePendingDeletes(items) {
  saveJsonArray(JERICHO_PENDING_DELETES_KEY, items);
}

function clearPendingDeletes() {
  localStorage.removeItem(JERICHO_PENDING_DELETES_KEY);
}

function setSyncButtonState(isSyncing, text) {
  document.querySelectorAll(".sync-now-btn").forEach(button => {
    button.disabled = false;
    button.style.pointerEvents = "auto";
    button.style.cursor = "pointer";
    button.textContent = isSyncing ? "Syncing..." : text;
  });

  const syncStatusText = document.getElementById("syncStatusText");

  if (syncStatusText) {
    syncStatusText.textContent = text;
  }

  console.log("SYNC STATUS:", text);
}

function showSyncMessage(message) {
  console.log("SYNC:", message);

  if (typeof showToast === "function") {
    showToast(message);
  }
}

function showRealError(stage, error) {
  console.error(stage, error);

  alert(
    "STEP FAILED: " + stage + "\n\n" +
    "Message:\n" + (error?.message || "No message") + "\n\n" +
    "Code:\n" + (error?.code || "No code") + "\n\n" +
    "Details:\n" + (error?.details || "No details") + "\n\n" +
    "Hint:\n" + (error?.hint || "No hint")
  );
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isDeletedRecord(record) {
  return record?._deleted === true || String(record?._deleted).toLowerCase() === "true";
}

function getRecordTime(record) {
  const value = record?.updatedAt || record?.createdAt || 0;
  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function getRecordIdentityKey(storeName, record) {
  if (!record) return null;

  if (storeName === "users") {
    const email = normalizeText(record.email);
    if (email) return "users:email:" + email;
  }

  if (storeName === "suppliers") {
    const supplierName = normalizeText(
      record.supplierName ||
      record.companyName ||
      record.name
    );

    if (supplierName) return "suppliers:name:" + supplierName;
  }

  if (record.id !== undefined && record.id !== null) {
    return storeName + ":id:" + String(record.id);
  }

  return null;
}

function markDirtyRecord(storeName, record, deleted = false) {
  if (window.__jerichoApplyingRemote || window.__jerichoSuppressWriteTracking) return;
  if (!storeName || !record) return;
  if (record.id === undefined || record.id === null || record.id === "") return;

  const now = new Date().toISOString();

  const cleanRecord = {
    ...record,
    _deleted: deleted ? true : record._deleted,
    deletedAt: deleted ? (record.deletedAt || now) : record.deletedAt,
    updatedAt: now
  };

  const dirtyMap = getDirtyMap();
  const key = `${storeName}:${String(cleanRecord.id)}`;

  dirtyMap[key] = {
    storeName,
    id: cleanRecord.id,
    deleted,
    record: cleanRecord
  };

  saveDirtyMap(dirtyMap);
  markLocalChanges();
}

function addPendingDelete(storeName, id, record = {}) {
  const now = new Date().toISOString();
  const items = getPendingDeletes();
  const key = `${storeName}:${String(id)}`;

  const filtered = items.filter(item => {
    return `${item.storeName}:${String(item.id)}` !== key;
  });

  filtered.push({
    storeName,
    id,
    record: {
      ...record,
      id,
      _deleted: true,
      deletedAt: record.deletedAt || now,
      updatedAt: now
    }
  });

  savePendingDeletes(filtered);
  markLocalChanges();
}

function normalizeRecordForCloud(record) {
  const now = new Date().toISOString();

  return {
    ...record,
    updatedAt: record.updatedAt || record.createdAt || now
  };
}

function prepareRecordForCloud(storeName, record) {
  const cleanRecord = normalizeRecordForCloud(record);

  return {
    store_name: storeName,
    local_id: String(cleanRecord.id),
    device_id: jerichoDeviceId,
    data: cleanRecord,
    updated_at: cleanRecord.updatedAt,
    synced_at: new Date().toISOString()
  };
}

function recordFromCloud(row) {
  const cloudRecord = row.data || {};

  return {
    ...cloudRecord,
    id: cloudRecord.id ?? Number(row.local_id),
    updatedAt:
      cloudRecord.updatedAt ||
      row.updated_at ||
      row.synced_at ||
      new Date().toISOString()
  };
}

function mergeRecords(storeName, records) {
  const merged = new Map();

  records.forEach(record => {
    if (!record) return;

    const key = getRecordIdentityKey(storeName, record);
    if (!key) return;

    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, record);
      return;
    }

    if (getRecordTime(record) >= getRecordTime(existing)) {
      merged.set(key, record);
    }
  });

  return Array.from(merged.values());
}

async function uploadRecordToCloud(storeName, record) {
  const cloudRecord = prepareRecordForCloud(storeName, record);

  const { error } = await getJerichoCloud().rpc(
    "sync_jericho_record_replace",
    {
      p_store_name: cloudRecord.store_name,
      p_local_id: cloudRecord.local_id,
      p_device_id: cloudRecord.device_id,
      p_data: cloudRecord.data,
      p_updated_at: cloudRecord.updated_at || new Date().toISOString()
    }
  );

  if (error) throw error;
}

async function getCloudRows() {
  const { data, error } = await getJerichoCloud()
    .from(JERICHO_SYNC_TABLE)
    .select("*")
    .in("store_name", JERICHO_SYNC_STORES)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return data || [];
}

async function replaceStoreRecords(storeName, records) {
  window.__jerichoApplyingRemote = true;

  try {
    await clearStore(storeName);

    for (const record of records) {
      if (!isDeletedRecord(record)) {
        await putRecord(storeName, record);
      }
    }
  } finally {
    window.__jerichoApplyingRemote = false;
  }
}

function patchLocalWriteTracking() {
  if (window.__jerichoWriteTrackingPatched) return;

  if (
    typeof window.addRecord !== "function" ||
    typeof window.putRecord !== "function" ||
    typeof window.deleteRecord !== "function"
  ) {
    console.warn("Write tracking not ready yet.");
    return;
  }

  const originalAddRecord = window.addRecord;
  const originalPutRecord = window.putRecord;
  const originalDeleteRecord = window.deleteRecord;

  window.addRecord = async function patchedAddRecord(storeName, record) {
    if (!window.__jerichoApplyingRemote && !window.__jerichoSuppressWriteTracking) {
      record.updatedAt = new Date().toISOString();
    }

    const newId = await originalAddRecord.call(this, storeName, record);

    if (!window.__jerichoApplyingRemote && !window.__jerichoSuppressWriteTracking) {
      markDirtyRecord(storeName, { ...(record || {}), id: newId }, false);
    }

    return newId;
  };

  window.putRecord = async function patchedPutRecord(storeName, record) {
    if (!window.__jerichoApplyingRemote && !window.__jerichoSuppressWriteTracking) {
      record.updatedAt = new Date().toISOString();
    }

    const result = await originalPutRecord.call(this, storeName, record);

    if (!window.__jerichoApplyingRemote && !window.__jerichoSuppressWriteTracking) {
      markDirtyRecord(storeName, record, isDeletedRecord(record));
    }

    return result;
  };

  window.deleteRecord = async function patchedDeleteRecord(storeName, id) {
    let existingRecord = null;

    if (!window.__jerichoApplyingRemote && !window.__jerichoSuppressWriteTracking) {
      try {
        const records = await getAll(storeName);
        existingRecord = records.find(record => String(record.id) === String(id)) || null;
      } catch (error) {
        existingRecord = null;
      }
    }

    const result = await originalDeleteRecord.call(this, storeName, id);

    if (!window.__jerichoApplyingRemote && !window.__jerichoSuppressWriteTracking) {
      addPendingDelete(storeName, id, existingRecord || {});
    }

    return result;
  };

  window.__jerichoWriteTrackingPatched = true;
}

async function syncRecordsToSupabase(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");

    if (!silent) {
      alert("You are offline. Connect to internet first.");
    }

    return 0;
  }

  try {
    await dbReady;
    patchLocalWriteTracking();

    const dirtyMap = getDirtyMap();
    const dirtyEntries = Object.values(dirtyMap);
    const pendingDeletes = getPendingDeletes();

    if (!dirtyEntries.length && !pendingDeletes.length && !hasLocalChanges()) {
      setSyncButtonState(false, "No local changes");
      return 0;
    }

    setSyncButtonState(true, "Uploading to Supabase...");

    let uploadedCount = 0;
    const uploadedKeys = new Set();

    for (const entry of dirtyEntries) {
      if (!entry || !entry.storeName) continue;

      const uploadKey = `${entry.storeName}:${String(entry.id)}`;
      uploadedKeys.add(uploadKey);

      let record = entry.record || {};

      if (!entry.deleted) {
        try {
          const allRecords = await getAll(entry.storeName);
          const latest = allRecords.find(item => String(item.id) === String(entry.id));
          if (latest) record = latest;
        } catch (error) {}
      }

      await uploadRecordToCloud(entry.storeName, record);
      uploadedCount += 1;
    }

    for (const item of pendingDeletes) {
      if (!item || !item.storeName) continue;

      const uploadKey = `${item.storeName}:${String(item.id)}`;

      if (uploadedKeys.has(uploadKey)) continue;

      const deletedRecord = {
        ...(item.record || {}),
        id: item.id,
        _deleted: true,
        deletedAt: item.record?.deletedAt || new Date().toISOString(),
        updatedAt: item.record?.updatedAt || new Date().toISOString()
      };

      await uploadRecordToCloud(item.storeName, deletedRecord);
      uploadedCount += 1;
    }

    clearDirtyMap();
    clearPendingDeletes();
    clearLocalChanges();

    localStorage.setItem(JERICHO_LAST_SYNC_KEY, new Date().toISOString());

    return uploadedCount;
  } catch (error) {
    setSyncButtonState(false, "Upload failed");

    if (!silent) {
      showRealError("UPLOAD TO SUPABASE", error);
    } else {
      console.error("UPLOAD TO SUPABASE", error);
    }

    throw error;
  }
}

async function freshDownloadFromCloud(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");

    if (!silent) {
      alert("You are offline. Connect to internet first.");
    }

    return 0;
  }

  try {
    await dbReady;
    patchLocalWriteTracking();

    setSyncButtonState(true, "Downloading fresh data...");

    const rows = await getCloudRows();
    const groupedRecords = {};

    JERICHO_SYNC_STORES.forEach(storeName => {
      groupedRecords[storeName] = [];
    });

    rows.forEach(row => {
      if (!groupedRecords[row.store_name]) return;

      groupedRecords[row.store_name].push(recordFromCloud(row));
    });

    let downloadedCount = 0;

    for (const storeName of JERICHO_SYNC_STORES) {
      const mergedRecords = mergeRecords(storeName, groupedRecords[storeName] || []);
      const activeRecords = mergedRecords.filter(record => !isDeletedRecord(record));

      downloadedCount += activeRecords.length;

      await replaceStoreRecords(storeName, activeRecords);
    }

    localStorage.setItem(JERICHO_LAST_SYNC_KEY, new Date().toISOString());

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    return downloadedCount;
  } catch (error) {
    setSyncButtonState(false, "Download failed");

    if (!silent) {
      showRealError("DOWNLOAD FROM SUPABASE", error);
    } else {
      console.error("DOWNLOAD FROM SUPABASE", error);
    }

    throw error;
  }
}

async function pullRecordsFromSupabase(options = {}) {
  return freshDownloadFromCloud(options);
}

async function clearLoginCookiesAndCacheAfterSync() {
  document.cookie.split(";").forEach(cookie => {
    const name = cookie.split("=")[0].trim();

    if (!name) return;

    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  if ("caches" in window) {
    const cacheNames = await caches.keys();

    for (const cacheName of cacheNames) {
      await caches.delete(cacheName);
    }
  }

  localStorage.clear();
  sessionStorage.clear();
}

async function syncNow(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");

    if (!silent) {
      alert("You are offline. Connect to internet first.");
    }

    return;
  }

  if (window.__jerichoSyncBusy) {
    if (!silent) {
      alert("Sync is already running. Please wait.");
    }

    return;
  }

  let uploaded = 0;
  let downloaded = 0;

  try {
    window.__jerichoSyncBusy = true;

    await dbReady;
    patchLocalWriteTracking();

    setSyncButtonState(true, "Uploading to Supabase...");
    uploaded = await syncRecordsToSupabase({ silent });

    setSyncButtonState(true, "Downloading fresh data...");
    downloaded = await freshDownloadFromCloud({ silent: true });

    setSyncButtonState(true, "Clearing login/cache...");
    await clearLoginCookiesAndCacheAfterSync();

    setSyncButtonState(false, "Synced");

    if (!silent) {
      alert(
        `Sync complete.\n\nThe app will reload. Log in again.`
      );
    }

    window.location.reload();
  } catch (error) {
    console.error("SYNC STOPPED:", error);

    setSyncButtonState(false, "Retry");

    if (!silent) {
      alert("Sync stopped.\n\nMessage: " + (error?.message || "Unknown sync error"));
    }
  } finally {
    window.__jerichoSyncBusy = false;
  }
}

function queueAutoSync() {
  patchLocalWriteTracking();
  markLocalChanges();
  setSyncButtonState(false, "Sync");
}

function scheduleAutoSync() {
  queueAutoSync();
}

async function deleteEverywhere(storeName, id) {
  await dbReady;
  patchLocalWriteTracking();

  const localRecords = await getAll(storeName);
  const recordToDelete = localRecords.find(record => String(record.id) === String(id));

  addPendingDelete(storeName, id, recordToDelete || {});

  window.__jerichoSuppressWriteTracking = true;

  try {
    await deleteRecord(storeName, id);

    const stillThere = await getAll(storeName);

    for (const record of stillThere) {
      if (String(record.id) === String(id)) {
        await deleteRecord(storeName, record.id);
      }
    }
  } finally {
    window.__jerichoSuppressWriteTracking = false;
  }

  markLocalChanges();
  setSyncButtonState(false, "Sync");

  if (typeof refreshAll === "function") {
    await refreshAll();
  }
}

function bindSyncButtons() {
  document.querySelectorAll(".sync-now-btn").forEach(button => {
    button.disabled = false;
    button.style.pointerEvents = "auto";
    button.style.cursor = "pointer";
  });
}

function startAutoSync() {
  bindSyncButtons();
  patchLocalWriteTracking();

  if (window.__jerichoAutoSyncReady === true) {
    return;
  }

  window.__jerichoAutoSyncReady = true;

  window.addEventListener("online", () => {
    setSyncButtonState(false, hasLocalChanges() ? "Sync" : "Sync Now");
  });

  window.addEventListener("offline", () => {
    setSyncButtonState(false, "Offline");
  });

  setSyncButtonState(false, navigator.onLine ? (hasLocalChanges() ? "Sync" : "Sync Now") : "Offline");
}

document.addEventListener(
  "click",
  async event => {
    const button = event.target.closest(".sync-now-btn");

    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    await syncNow({ silent: false });
  },
  true
);

document.addEventListener("DOMContentLoaded", () => {
  bindSyncButtons();
  patchLocalWriteTracking();
  setSyncButtonState(false, navigator.onLine ? (hasLocalChanges() ? "Sync" : "Sync Now") : "Offline");
});

window.pullRecordsFromSupabase = pullRecordsFromSupabase;
window.syncRecordsToSupabase = syncRecordsToSupabase;
window.queueAutoSync = queueAutoSync;
window.scheduleAutoSync = scheduleAutoSync;
window.syncNow = syncNow;
window.startAutoSync = startAutoSync;
window.deleteEverywhere = deleteEverywhere;