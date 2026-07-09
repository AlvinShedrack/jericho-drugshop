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
const JERICHO_DIRTY_RECORDS_KEY = "jericho_dirty_records_v2";

window.__jerichoSyncBusy = false;
window.__jerichoSyncTimer = null;
window.__jerichoAutoSyncReady = false;
window.__jerichoApplyingRemote = false;

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

function getDirtyMap() {
  try {
    return JSON.parse(localStorage.getItem(JERICHO_DIRTY_RECORDS_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function saveDirtyMap(map) {
  localStorage.setItem(JERICHO_DIRTY_RECORDS_KEY, JSON.stringify(map));
}

function clearDirtyMap() {
  localStorage.removeItem(JERICHO_DIRTY_RECORDS_KEY);
}

function markDirtyRecord(storeName, record, deleted = false) {
  if (window.__jerichoApplyingRemote) return;
  if (!storeName || !record) return;

  const id = record.id;

  if (id === undefined || id === null || id === "") return;

  const now = new Date().toISOString();

  const dirtyRecord = {
    ...record,
    id,
    _deleted: deleted ? true : record._deleted,
    deletedAt: deleted ? (record.deletedAt || now) : record.deletedAt,
    updatedAt: now
  };

  const key = `${storeName}:${String(id)}`;
  const dirtyMap = getDirtyMap();

  dirtyMap[key] = {
    storeName,
    id,
    deleted,
    record: dirtyRecord
  };

  saveDirtyMap(dirtyMap);
}

function removeDirtyRecord(storeName, id) {
  const dirtyMap = getDirtyMap();
  delete dirtyMap[`${storeName}:${String(id)}`];
  saveDirtyMap(dirtyMap);
}

function getDirtyEntries() {
  return Object.values(getDirtyMap());
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

function mergeRecords(storeName, localRecords, cloudRecords) {
  const merged = new Map();

  [...localRecords, ...cloudRecords].forEach(record => {
    if (!record || isDeletedRecord(record)) return;

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

  return Array.from(merged.values()).filter(record => !isDeletedRecord(record));
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
    console.warn("Write tracking not patched because db.js functions are missing.");
    return;
  }

  const originalAddRecord = window.addRecord;
  const originalPutRecord = window.putRecord;
  const originalDeleteRecord = window.deleteRecord;

  window.addRecord = async function patchedAddRecord(storeName, record) {
    if (!window.__jerichoApplyingRemote && record && typeof record === "object") {
      record.updatedAt = new Date().toISOString();
    }

    const newId = await originalAddRecord.call(this, storeName, record);

    if (!window.__jerichoApplyingRemote) {
      markDirtyRecord(storeName, { ...(record || {}), id: newId }, false);
    }

    return newId;
  };

  window.putRecord = async function patchedPutRecord(storeName, record) {
    if (!window.__jerichoApplyingRemote && record && typeof record === "object") {
      record.updatedAt = new Date().toISOString();
    }

    const result = await originalPutRecord.call(this, storeName, record);

    if (!window.__jerichoApplyingRemote) {
      markDirtyRecord(storeName, record, isDeletedRecord(record));
    }

    return result;
  };

  window.deleteRecord = async function patchedDeleteRecord(storeName, id) {
    let existingRecord = null;

    if (!window.__jerichoApplyingRemote && typeof getById === "function") {
      try {
        existingRecord = await getById(storeName, id);
      } catch (error) {
        existingRecord = null;
      }
    }

    const result = await originalDeleteRecord.call(this, storeName, id);

    if (!window.__jerichoApplyingRemote) {
      markDirtyRecord(
        storeName,
        {
          ...(existingRecord || {}),
          id,
          _deleted: true,
          deletedAt: new Date().toISOString()
        },
        true
      );
    }

    return result;
  };

  window.__jerichoWriteTrackingPatched = true;
}

async function uploadOneRecord(storeName, record) {
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

  return cloudRecord;
}

async function syncRecordsToSupabase(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");

    if (!silent) {
      alert("You are offline. Records will sync when internet is available.");
    }

    return 0;
  }

  try {
    await dbReady;
    patchLocalWriteTracking();

    setSyncButtonState(true, "Uploading...");

    const dirtyEntries = getDirtyEntries();

    if (!dirtyEntries.length) {
      setSyncButtonState(false, "No local changes");
      return 0;
    }

    let uploadedCount = 0;

    for (const entry of dirtyEntries) {
      const storeName = entry.storeName;
      const id = entry.id;

      let record = null;

      if (!entry.deleted) {
        record = await getById(storeName, id);
      }

      if (!record) {
        record = {
          ...(entry.record || {}),
          id,
          _deleted: true,
          deletedAt: entry.record?.deletedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      await uploadOneRecord(storeName, record);
      removeDirtyRecord(storeName, id);
      uploadedCount += 1;
    }

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

    setSyncButtonState(true, "Fresh downloading...");

    const { data, error } = await getJerichoCloud()
      .from(JERICHO_SYNC_TABLE)
      .select("*")
      .in("store_name", JERICHO_SYNC_STORES)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const groupedCloudRecords = {};

    JERICHO_SYNC_STORES.forEach(storeName => {
      groupedCloudRecords[storeName] = [];
    });

    (data || []).forEach(row => {
      if (!groupedCloudRecords[row.store_name]) return;

      const record = recordFromCloud(row);

      if (isDeletedRecord(record)) return;

      groupedCloudRecords[row.store_name].push(record);
    });

    let downloadedCount = 0;

    for (const storeName of JERICHO_SYNC_STORES) {
      const cloudRecords = groupedCloudRecords[storeName] || [];
      const cleanRecords = mergeRecords(storeName, [], cloudRecords);

      downloadedCount += cleanRecords.length;

      await replaceStoreRecords(storeName, cleanRecords);
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

    setSyncButtonState(true, "Syncing...");
    showSyncMessage("Sync started...");

    uploaded = await syncRecordsToSupabase({ silent });
    downloaded = await freshDownloadFromCloud({ silent });

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    setSyncButtonState(false, "Synced");

    setTimeout(() => {
      setSyncButtonState(false, "Sync Now");
    }, 2500);

    if (!silent) {
      alert(`Sync complete.\nUploaded: ${uploaded}\nDownloaded: ${downloaded}`);
    }
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

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");
    return;
  }

  clearTimeout(window.__jerichoSyncTimer);

  window.__jerichoSyncTimer = setTimeout(async () => {
    await syncNow({ silent: true });
  }, 1500);
}

function scheduleAutoSync() {
  queueAutoSync();
}

async function deleteEverywhere(storeName, id) {
  if (!navigator.onLine) {
    throw new Error("You are offline. Connect to internet before deleting this record.");
  }

  await dbReady;
  patchLocalWriteTracking();

  const localRecords = await getAll(storeName);
  const recordToDelete = localRecords.find(record => String(record.id) === String(id));

  const deletedRecord = {
    ...(recordToDelete || {}),
    id,
    _deleted: true,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await uploadOneRecord(storeName, deletedRecord);

  window.__jerichoApplyingRemote = true;

  try {
    await deleteRecord(storeName, id);

    const remainingRecords = await getAll(storeName);

    for (const record of remainingRecords) {
      if (String(record.id) === String(id)) {
        await deleteRecord(storeName, record.id);
      }
    }
  } finally {
    window.__jerichoApplyingRemote = false;
  }

  removeDirtyRecord(storeName, id);

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
    setSyncButtonState(false, "Sync Now");

    setTimeout(async () => {
      await syncNow({ silent: true });
    }, 800);
  });

  window.addEventListener("offline", () => {
    setSyncButtonState(false, "Offline");
  });

  if (navigator.onLine) {
    setSyncButtonState(false, "Sync Now");
  } else {
    setSyncButtonState(false, "Offline");
  }
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
  setSyncButtonState(false, navigator.onLine ? "Sync Now" : "Offline");
});

window.pullRecordsFromSupabase = pullRecordsFromSupabase;
window.syncRecordsToSupabase = syncRecordsToSupabase;
window.queueAutoSync = queueAutoSync;
window.scheduleAutoSync = scheduleAutoSync;
window.syncNow = syncNow;
window.startAutoSync = startAutoSync;
window.deleteEverywhere = deleteEverywhere;