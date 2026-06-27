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

function getDeviceId() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);

  if (!deviceId) {
    deviceId = "device_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  return deviceId;
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

function prepareRecordForCloud(storeName, record) {
  return {
    store_name: storeName,
    local_id: String(record.id),
    device_id: getDeviceId(),
    data: record,
    updated_at: record.updatedAt || record.createdAt || new Date().toISOString(),
    deleted: false
  };
}

async function pushLocalStoreToCloud(storeName) {
  const localRecords = await getAll(storeName);

  if (!localRecords.length) {
    return 0;
  }

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

async function pullCloudStoreToLocal(storeName) {
  const { data, error } = await cloudClient
    .from("cloud_records")
    .select("*")
    .eq("store_name", storeName);

  if (error) {
    throw error;
  }

  let imported = 0;

  for (const row of data || []) {
    if (row.deleted) continue;

    const cloudRecord = row.data;
    const localRecord = await getById(storeName, cloudRecord.id);

    if (!localRecord) {
      await putRecord(storeName, cloudRecord);
      imported++;
      continue;
    }

    const localTime = new Date(localRecord.updatedAt || localRecord.createdAt || 0).getTime();
    const cloudTime = new Date(cloudRecord.updatedAt || cloudRecord.createdAt || row.updated_at || 0).getTime();

    if (cloudTime > localTime) {
      await putRecord(storeName, cloudRecord);
      imported++;
    }
  }

  return imported;
}

let syncRunning = false;
let autoSyncStarted = false;
let queuedSyncTimer = null;

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

  // Sync shortly after login
  queueAutoSync(3000);

  // Sync when internet comes back
  window.addEventListener("online", () => {
    queueAutoSync(1000);
  });

  // Sync every 3 minutes while app is open
  setInterval(() => {
    if (navigator.onLine) {
      syncNow();
    }
  }, 3 * 60 * 1000);
}

async function syncNow() {
  if (syncRunning) return;

  if (!navigator.onLine) {
    setSyncStatus("Offline. Connect to internet to sync.");
    updateSyncButtons("Offline. Connect to internet to sync.", false);
    return;
  }

  syncRunning = true;
  updateSyncButtons("Syncing data...", true);
  setSyncStatus("Syncing data...");

  try {
    let pushed = 0;
    let pulled = 0;

    for (const storeName of SYNC_STORES) {
      pushed += await pushLocalStoreToCloud(storeName);
    }

    for (const storeName of SYNC_STORES) {
      pulled += await pullCloudStoreToLocal(storeName);
    }

    const now = new Date().toLocaleString();
    localStorage.setItem(LAST_SYNC_KEY, now);

    const message = `Sync complete. Uploaded ${pushed}, downloaded ${pulled}. Last sync: ${now}`;

    setSyncStatus(message);
    updateSyncButtons(message, false);

    if (typeof refreshAll === "function") {
      await refreshAll();
    }
  } catch (error) {
    console.error("Sync error:", error);
    setSyncStatus("Sync failed. Check internet or Supabase settings.");
    updateSyncButtons("Sync failed. Check internet or Supabase settings.", false);
  } finally {
    syncRunning = false;
  }
}