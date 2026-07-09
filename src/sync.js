const JERICHO_SUPABASE_URL = "https://rorqfxjnupdnqzcozeut.supabase.co";
const JERICHO_SUPABASE_PUBLIC_KEY = "sb_publishable_ZCCvcvPKoSDuY4JpRgwghw_Wt35MjBx";

if (!window.supabase) {
  alert("Supabase library is not loaded. Check script order and internet connection.");
  throw new Error("Supabase library is not loaded.");
}

function getJerichoCloud() {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase library is not loaded correctly.");
  }

  if (!JERICHO_SUPABASE_URL || JERICHO_SUPABASE_URL.includes("PASTE_")) {
    throw new Error("Supabase URL is missing in sync.js.");
  }

  if (!JERICHO_SUPABASE_PUBLIC_KEY || JERICHO_SUPABASE_PUBLIC_KEY.includes("PASTE_")) {
    throw new Error("Supabase public key is missing in sync.js.");
  }

  if (!window.cloudClient || typeof window.cloudClient.from !== "function") {
    window.cloudClient = window.supabase.createClient(
      JERICHO_SUPABASE_URL,
      JERICHO_SUPABASE_PUBLIC_KEY
    );
  }

  return window.cloudClient;
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
const JERICHO_DELETED_KEYS = "jericho_deleted_record_keys";

function getDeletedKeys() {
  try {
    return JSON.parse(localStorage.getItem(JERICHO_DELETED_KEYS) || "[]");
  } catch {
    return [];
  }
}

function saveDeletedKey(key) {
  if (!key) return;

  const keys = new Set(getDeletedKeys());
  keys.add(key);

  localStorage.setItem(JERICHO_DELETED_KEYS, JSON.stringify([...keys]));
}

function isLocallyDeleted(storeName, record) {
  const key = getRecordIdentityKey(storeName, record);
  return key && getDeletedKeys().includes(key);
}
window.__jerichoSyncBusy = false;
window.__jerichoSyncTimer = null;
window.__jerichoAutoSyncReady = false;

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
function showSyncFailedInternetMessage(silent = false) {
  const message = "Sync failed because of internet issues.";

  setSyncButtonState(false, "Sync failed");

  if (!silent) {
    alert(message);
  } else {
    console.warn(message);
  }
}
function showRealError(stage, error) {
  console.error(stage, error);

  const errorText =
    "STEP FAILED: " + stage + "\n\n" +
    "Message:\n" + (error?.message || "No message") + "\n\n" +
    "Code:\n" + (error?.code || "No code") + "\n\n" +
    "Details:\n" + (error?.details || "No details") + "\n\n" +
    "Hint:\n" + (error?.hint || "No hint") + "\n\n" +
    "Full Error:\n" + JSON.stringify(error, null, 2);

  alert(errorText);
}

function getRecordTime(record) {
  const value = record?.updatedAt || record?.createdAt || 0;
  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function getRecordIdentityKey(storeName, record) {
  if (!record) return null;

  if (storeName === "users") {
    const email = normalizeText(record.email);

    if (email) {
      return "users:email:" + email;
    }
  }

  if (storeName === "suppliers") {
    const supplierName = normalizeText(
      record.supplierName ||
      record.companyName ||
      record.name
    );

    if (supplierName) {
      return "suppliers:name:" + supplierName;
    }
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
function isDeletedRecord(record) {
  return record?._deleted === true || String(record?._deleted).toLowerCase() === "true";
}

async function deleteMatchingLocalRecords(storeName, deletedRecord) {
  const deletedKey = getRecordIdentityKey(storeName, deletedRecord);
  const localRecords = await getAll(storeName);

  for (const record of localRecords) {
    const sameId = String(record.id) === String(deletedRecord.id);
    const sameKey = deletedKey && getRecordIdentityKey(storeName, record) === deletedKey;

    if (sameId || sameKey) {
      await deleteRecord(storeName, record.id);
    }
  }
}
function isDeletedRecord(record) {
  return record?._deleted === true;
}

function makeDeletedRecord(record, id) {
  const now = new Date().toISOString();

  return {
    ...(record || {}),
    id: record?.id ?? Number(id),
    _deleted: true,
    deletedAt: now,
    updatedAt: now
  };
}

async function deleteMatchingLocalRecords(storeName, deletedRecord) {
  const deletedKey = getRecordIdentityKey(storeName, deletedRecord);
  const localRecords = await getAll(storeName);

  for (const record of localRecords) {
    const sameId = String(record.id) === String(deletedRecord.id);
    const sameKey = deletedKey && getRecordIdentityKey(storeName, record) === deletedKey;

    if (sameId || sameKey) {
      await deleteRecord(storeName, record.id);
    }
  }
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
    const key = getRecordIdentityKey(storeName, record);

    if (!key) return;

    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, record);
      return;
    }

    const existingTime = getRecordTime(existing);
    const recordTime = getRecordTime(record);

    if (recordTime >= existingTime) {
      merged.set(key, record);
    }
  });

  return Array.from(merged.values());
}

async function replaceStoreRecords(storeName, records) {
  await clearStore(storeName);

  for (const record of records) {
    await putRecord(storeName, record);
  }
}

async function pullRecordsFromSupabase(options = {}) {
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

    setSyncButtonState(true, "Downloading...");

    const { data, error } = await getJerichoCloud()
      .from(JERICHO_SYNC_TABLE)
      .select("*")
      .in("store_name", JERICHO_SYNC_STORES)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    const groupedCloudRecords = {};

    JERICHO_SYNC_STORES.forEach(storeName => {
      groupedCloudRecords[storeName] = [];
    });

    (data || []).forEach(row => {
      if (!groupedCloudRecords[row.store_name]) return;
      groupedCloudRecords[row.store_name].push(recordFromCloud(row));
    });

    let downloadedCount = 0;

    for (const storeName of JERICHO_SYNC_STORES) {
      const cloudRecords = groupedCloudRecords[storeName] || [];

      downloadedCount += cloudRecords.length;

      const deletedCloudRecords = cloudRecords.filter(isDeletedRecord);
      const activeCloudRecords = cloudRecords.filter(record => !isDeletedRecord(record));

      for (const deletedRecord of deletedCloudRecords) {
        await deleteMatchingLocalRecords(storeName, deletedRecord);
      }

      const localRecords = await getAll(storeName);

      const mergedRecords = mergeRecords(storeName, localRecords, activeCloudRecords)
        .filter(record => !isDeletedRecord(record));

      await replaceStoreRecords(storeName, mergedRecords);
    }

    localStorage.setItem(JERICHO_LAST_SYNC_KEY, new Date().toISOString());

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    return downloadedCount;
  } catch (error) {
    console.error("DOWNLOAD FROM SUPABASE", error);
    showSyncFailedInternetMessage(silent);
    throw error;
  }
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

    setSyncButtonState(true, "Uploading...");

    const payload = [];

    for (const storeName of JERICHO_SYNC_STORES) {
      const localRecords = await getAll(storeName);

      localRecords.forEach(record => {
        if (record.id === undefined || record.id === null) return;
        payload.push(prepareRecordForCloud(storeName, record));
      });
    }

    console.log("UPLOAD PAYLOAD COUNT:", payload.length);
    console.log("UPLOAD PAYLOAD SAMPLE:", payload.slice(0, 3));

    if (!payload.length) {
      setSyncButtonState(false, "No records");

      if (!silent) {
        alert("There are no records to sync.");
      }

      return 0;
    }

    let uploadedCount = 0;

    for (const record of payload) {
      const { data, error } = await getJerichoCloud().rpc(
        "sync_jericho_record_replace",
        {
          p_store_name: record.store_name,
          p_local_id: record.local_id,
          p_device_id: record.device_id,
          p_data: record.data,
          p_updated_at: record.updated_at || new Date().toISOString()
        }
      );

      if (error) {
        console.error("UPLOAD FAILED RECORD:", record);
        throw error;
      }

      uploadedCount += 1;
      console.log("UPLOAD SUCCESS RECORD:", data);
    }

    console.log("UPLOAD SUCCESS COUNT:", uploadedCount);

    localStorage.setItem(JERICHO_LAST_SYNC_KEY, new Date().toISOString());

    return uploadedCount;
  } catch (error) {
    console.error("UPLOAD TO SUPABASE", error);
    showSyncFailedInternetMessage(silent);
    throw error;
  }
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
  let uploaded = 0;

  try {
    window.__jerichoSyncBusy = true;

    setSyncButtonState(true, "Syncing...");
    showSyncMessage("Sync started...");
    downloaded = await pullRecordsFromSupabase({ silent });
    uploaded = await syncRecordsToSupabase({ silent });
    downloaded += await pullRecordsFromSupabase({ silent });


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
    showSyncFailedInternetMessage(silent);
  } finally {
    window.__jerichoSyncBusy = false;
  }
}

function queueAutoSync() {
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
  const deletedRecord = makeDeletedRecord(recordToDelete, id);

  const { error } = await getJerichoCloud().rpc(
    "sync_jericho_record_replace",
    {
      p_store_name: storeName,
      p_local_id: String(id),
      p_device_id: jerichoDeviceId,
      p_data: deletedRecord,
      p_updated_at: deletedRecord.updatedAt
    }
  );

  if (error) {
    throw error;
  }

  await deleteMatchingLocalRecords(storeName, deletedRecord);

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
    queueAutoSync();
  });

  window.addEventListener("offline", () => {
    setSyncButtonState(false, "Offline");
  });

  if (navigator.onLine) {
    setSyncButtonState(false, "Sync Now");
    queueAutoSync();
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

    console.log("Sync button clicked.");

    await syncNow({ silent: false });
  },
  true
);

document.addEventListener("DOMContentLoaded", () => {
  bindSyncButtons();
  setSyncButtonState(false, navigator.onLine ? "Sync Now" : "Offline");
});

window.pullRecordsFromSupabase = pullRecordsFromSupabase;
window.syncRecordsToSupabase = syncRecordsToSupabase;
window.queueAutoSync = queueAutoSync;
window.scheduleAutoSync = scheduleAutoSync;
window.syncNow = syncNow;
window.startAutoSync = startAutoSync;
window.deleteEverywhere = deleteEverywhere;