const SUPABASE_URL = "https://rorqfxjnupdnqzcozeut.supabase.co";
const SUPABASE_KEY = "sb_publishable_ZCCvcvPKoSDuY4JpRgwghw_Wt35MjBx";

const cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const SYNC_STORES = [
  "users",
  "suppliers",
  "medicines",
  "sales",
  "purchases",
  "expenses",
  "auditLogs"
];

const DEVICE_ID_KEY = "jericho_device_id";
const LAST_SYNC_KEY = "jericho_last_sync";

let syncRunning = false;
let autoSyncStarted = false;
let queuedSyncTimer = null;

function getDeviceId() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);

  if (!deviceId) {
    deviceId = "device_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  return deviceId;
}

function getRecordTime(record, fallbackDate = null) {
  const value = record?.updatedAt || record?.createdAt || fallbackDate || 0;
  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function setSyncStatus(message) {
  const syncStatusText = document.getElementById("syncStatusText");

  if (syncStatusText) {
    syncStatusText.textContent = message;
  }

  if (typeof showToast === "function") {
    showToast(message);
  }
}

function updateSyncButtons(text, busy = false) {
  document.querySelectorAll(".sync-now-btn").forEach(button => {
    button.textContent = busy ? "Syncing..." : "🔄 Sync";
    button.disabled = busy;
  });

  const syncStatusText = document.getElementById("syncStatusText");
  if (syncStatusText) {
    syncStatusText.textContent = text;
  }
}

function prepareRecordForCloud(storeName, record) {
  const now = new Date().toISOString();

  const cleanRecord = {
    ...record,
    updatedAt: record.updatedAt || record.createdAt || now
  };

  return {
    store_name: storeName,
    local_id: String(cleanRecord.id),
    device_id: getDeviceId(),
    data: cleanRecord,
    updated_at: cleanRecord.updatedAt,
    deleted: false
  };
}

async function pullCloudStoreToLocal(storeName) {
  const { data, error } = await cloudClient
    .from("cloud_records")
    .select("*")
    .eq("store_name", storeName)
    .order("updated_at", { ascending: true });

  if (error) {
    throw error;
  }

  let imported = 0;

  for (const row of data || []) {
    if (row.deleted) continue;
    if (!row.data) continue;

    const cloudRecord = {
      ...row.data,
      id: row.data.id ?? Number(row.local_id)
    };

    if (cloudRecord.id === undefined || cloudRecord.id === null) {
      continue;
    }

    const localRecord = await getById(storeName, cloudRecord.id);

    if (!localRecord) {
      await putRecord(storeName, cloudRecord);
      imported++;
      continue;
    }

    const localTime = getRecordTime(localRecord);
    const cloudTime = getRecordTime(cloudRecord, row.updated_at);

    if (cloudTime > localTime) {
      await putRecord(storeName, cloudRecord);
      imported++;
    }
  }

  return imported;
}

async function pushLocalStoreToCloud(storeName) {
  const localRecords = await getAll(storeName);

  const cloudRows = localRecords
    .filter(record => record.id !== undefined && record.id !== null)
    .map(record => prepareRecordForCloud(storeName, record));

  if (!cloudRows.length) {
    return 0;
  }

  const { error } = await cloudClient
    .from("cloud_records")
    .upsert(cloudRows, {
      onConflict: "store_name,local_id"
    });

  if (error) {
    throw error;
  }

  return cloudRows.length;
}

async function pullAllCloudDataFirst() {
  let pulled = 0;

  for (const storeName of SYNC_STORES) {
    pulled += await pullCloudStoreToLocal(storeName);
  }

  return pulled;
}

async function pushAllLocalData() {
  let pushed = 0;

  for (const storeName of SYNC_STORES) {
    pushed += await pushLocalStoreToCloud(storeName);
  }

  return pushed;
}

function queueAutoSync(delay = 2500) {
  clearTimeout(queuedSyncTimer);

  queuedSyncTimer = setTimeout(() => {
    if (navigator.onLine && typeof syncNow === "function") {
      syncNow();
    }
  }, delay);
}

function startAutoSync() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  queueAutoSync(3000);

  window.addEventListener("online", () => {
    queueAutoSync(1000);
  });

  setInterval(() => {
    if (navigator.onLine) {
      syncNow();
    }
  }, 3 * 60 * 1000);
}

async function syncNow() {
  if (syncRunning) return;

  if (!navigator.onLine) {
    const message = "Offline. Connect to internet to sync.";
    setSyncStatus(message);
    updateSyncButtons(message, false);
    return;
  }

  syncRunning = true;
  updateSyncButtons("Fetching cloud data first...", true);
  setSyncStatus("Fetching cloud data first...");

  try {
    // 1. IMPORTANT: download Supabase data first
    const pulledBeforePush = await pullAllCloudDataFirst();

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    // 2. After local app has received cloud data, upload local records
    updateSyncButtons("Uploading local changes...", true);
    setSyncStatus("Uploading local changes...");

    const pushed = await pushAllLocalData();

    // 3. Pull again after upload to make sure this device has final cloud state
    updateSyncButtons("Finalizing sync...", true);
    setSyncStatus("Finalizing sync...");

    const pulledAfterPush = await pullAllCloudDataFirst();

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    const now = new Date().toLocaleString();
    localStorage.setItem(LAST_SYNC_KEY, now);

    const totalPulled = pulledBeforePush + pulledAfterPush;

    const message = `Sync complete. Downloaded ${totalPulled}, uploaded ${pushed}. Last sync: ${now}`;

    setSyncStatus(message);
    updateSyncButtons(message, false);

  } catch (error) {
    console.error("Sync error:", error);

    const message = error?.message
      ? `Sync failed: ${error.message}`
      : "Sync failed. Check internet or Supabase settings.";

    setSyncStatus(message);
    updateSyncButtons(message, false);

  } finally {
    syncRunning = false;
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest(".sync-now-btn");

  if (!button) return;

  event.preventDefault();
  syncNow();
});