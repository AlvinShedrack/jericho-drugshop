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
const JERICHO_LOCAL_CHANGES_KEY = "jericho_has_local_changes_v3";
const JERICHO_SYNC_AFTER_RELOAD_KEY = "jericho_sync_after_reload";

window.__jerichoSyncBusy = false;
window.__jerichoSyncTimer = null;
window.__jerichoAutoSyncReady = false;

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

async function replaceStoreRecords(storeName, records) {
  await clearStore(storeName);

  for (const record of records) {
    if (!isDeletedRecord(record)) {
      await putRecord(storeName, record);
    }
  }
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

function buildCloudMap(rows) {
  const map = new Map();

  rows.forEach(row => {
    const storeName = row.store_name;
    const record = recordFromCloud(row);
    const key = getRecordIdentityKey(storeName, record);

    if (!key) return;

    const mapKey = `${storeName}|${key}`;
    const existing = map.get(mapKey);

    if (!existing || getRecordTime(record) >= getRecordTime(existing)) {
      map.set(mapKey, record);
    }
  });

  return map;
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

    if (!hasLocalChanges()) {
      setSyncButtonState(false, "No local changes");
      return 0;
    }

    setSyncButtonState(true, "Uploading...");

    const cloudRows = await getCloudRows();
    const cloudMap = buildCloudMap(cloudRows);

    let uploadedCount = 0;

    for (const storeName of JERICHO_SYNC_STORES) {
      const localRecords = await getAll(storeName);

      for (const localRecord of localRecords) {
        if (localRecord.id === undefined || localRecord.id === null) continue;

        const key = getRecordIdentityKey(storeName, localRecord);
        if (!key) continue;

        const cloudRecord = cloudMap.get(`${storeName}|${key}`);

        const localTime = getRecordTime(localRecord);
        const cloudTime = getRecordTime(cloudRecord);

        if (!cloudRecord || localTime > cloudTime) {
          await uploadRecordToCloud(storeName, localRecord);
          uploadedCount += 1;
        }
      }
    }

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

    setSyncButtonState(true, "Downloading fresh data...");

    const rows = await getCloudRows();

    const groupedRecords = {};

    JERICHO_SYNC_STORES.forEach(storeName => {
      groupedRecords[storeName] = [];
    });

    rows.forEach(row => {
      if (!groupedRecords[row.store_name]) return;

      const record = recordFromCloud(row);
      groupedRecords[row.store_name].push(record);
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

  let downloaded = 0;

  try {
    window.__jerichoSyncBusy = true;

    setSyncButtonState(true, "Clearing local data...");
    showSyncMessage("Clearing local app data...");

    await dbReady;

    // This is the important part.
    // It clears the local browser app data like clearing site cookies/storage.
    for (const storeName of JERICHO_SYNC_STORES) {
      await clearStore(storeName);
    }

    localStorage.removeItem("jericho_has_local_changes");
    localStorage.removeItem("jericho_has_local_changes_v3");
    localStorage.removeItem("jericho_dirty_records_v2");

    setSyncButtonState(true, "Downloading fresh data...");

    const { data, error } = await getJerichoCloud()
      .from(JERICHO_SYNC_TABLE)
      .select("*")
      .in("store_name", JERICHO_SYNC_STORES)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    const groupedRecords = {};

    JERICHO_SYNC_STORES.forEach(storeName => {
      groupedRecords[storeName] = [];
    });

    (data || []).forEach(row => {
      if (!groupedRecords[row.store_name]) return;

      const record = recordFromCloud(row);

      const isDeleted =
        record?._deleted === true ||
        String(record?._deleted).toLowerCase() === "true";

      if (!isDeleted) {
        groupedRecords[row.store_name].push(record);
      }
    });

    for (const storeName of JERICHO_SYNC_STORES) {
      const records = groupedRecords[storeName] || [];

      const uniqueMap = new Map();

      for (const record of records) {
        const key = getRecordIdentityKey(storeName, record);

        if (!key) continue;

        const existing = uniqueMap.get(key);

        if (!existing || getRecordTime(record) >= getRecordTime(existing)) {
          uniqueMap.set(key, record);
        }
      }

      const cleanRecords = Array.from(uniqueMap.values());

      downloaded += cleanRecords.length;

      for (const record of cleanRecords) {
        await putRecord(storeName, record);
      }
    }

    localStorage.setItem(JERICHO_LAST_SYNC_KEY, new Date().toISOString());

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    setSyncButtonState(false, "Synced");

    setTimeout(() => {
      setSyncButtonState(false, "Sync Now");
    }, 2500);

    if (!silent) {
      alert(`Fresh sync complete.\nDownloaded: ${downloaded}`);
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
  markLocalChanges();

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

  const localRecords = await getAll(storeName);
  const recordToDelete = localRecords.find(record => String(record.id) === String(id));

  const deletedRecord = {
    ...(recordToDelete || {}),
    id,
    _deleted: true,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await uploadRecordToCloud(storeName, deletedRecord);

  await deleteRecord(storeName, id);

  const stillThere = await getAll(storeName);

  for (const record of stillThere) {
    if (String(record.id) === String(id)) {
      await deleteRecord(storeName, record.id);
    }
  }

  markLocalChanges();

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

  setSyncButtonState(false, navigator.onLine ? "Sync Now" : "Offline");
}
function hardRefreshThenSync() {
  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");
    alert("You are offline. Connect to internet first.");
    return;
  }

  sessionStorage.setItem(JERICHO_SYNC_AFTER_RELOAD_KEY, "true");

  window.location.reload();
}

async function continueSyncAfterHardRefresh() {
  const shouldSync = sessionStorage.getItem(JERICHO_SYNC_AFTER_RELOAD_KEY);

  if (shouldSync !== "true") {
    return;
  }

  sessionStorage.removeItem(JERICHO_SYNC_AFTER_RELOAD_KEY);

  setTimeout(async () => {
    await syncNow({ silent: false, skipHardRefresh: true });
  }, 1000);
}
document.addEventListener(
  "click",
  event => {
    const button = event.target.closest(".sync-now-btn");

    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    hardRefreshThenSync();
  },
  true
);

document.addEventListener("DOMContentLoaded", () => {
  bindSyncButtons();
  setSyncButtonState(false, navigator.onLine ? "Sync Now" : "Offline");
  continueSyncAfterHardRefresh();
});
window.pullRecordsFromSupabase = pullRecordsFromSupabase;
window.syncRecordsToSupabase = syncRecordsToSupabase;
window.queueAutoSync = queueAutoSync;
window.scheduleAutoSync = scheduleAutoSync;
window.syncNow = syncNow;
window.startAutoSync = startAutoSync;
window.deleteEverywhere = deleteEverywhere;