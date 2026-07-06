const SUPABASE_URL = "https://rorqfxjnupdnqzcozeut.supabase.co";
const SUPABASE_KEY = "sb_publishable_ZCCvcvPKoSDuY4JpRgwghw_Wt35MjBx";


if (!window.supabase) {
  throw new Error("Supabase library is not loaded. Check your script order.");
}

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLIC_KEY
);

window.cloudClient = supabaseClient;

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
const LAST_SYNC_KEY = "jericho_last_supabase_sync_at";

let syncInProgress = false;
let syncTimer = null;
let autoSyncStarted = false;

function getDeviceId() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);

  if (!deviceId) {
    if (crypto.randomUUID) {
      deviceId = crypto.randomUUID();
    } else {
      deviceId = "device_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    }

    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  return deviceId;
}

const deviceId = getDeviceId();

function setSyncButtonState(isSyncing, text) {
  document.querySelectorAll(".sync-now-btn").forEach(button => {
    button.disabled = isSyncing;
    button.textContent = isSyncing ? "Syncing..." : text;
  });

  const syncStatusText = document.getElementById("syncStatusText");
  if (syncStatusText) {
    syncStatusText.textContent = text;
  }
}

function getRecordTime(record) {
  const value = record?.updatedAt || record?.createdAt || 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
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
    device_id: deviceId,
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
    updatedAt: cloudRecord.updatedAt || row.updated_at || row.synced_at || new Date().toISOString()
  };
}

function mergeRecords(localRecords, cloudRecords) {
  const merged = new Map();

  [...localRecords, ...cloudRecords].forEach(record => {
    if (record.id === undefined || record.id === null) return;

    const key = String(record.id);
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

async function replaceStoreRecords(storeName, mergedRecords) {
  await clearStore(storeName);

  for (const record of mergedRecords) {
    await putRecord(storeName, record);
  }
}

async function pullRecordsFromSupabase(options = {}) {
  const silent = options.silent === true;

  if (!supabaseClient) {
    if (!silent) alert("Supabase is not configured correctly.");
    return;
  }

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");
    if (!silent) alert("You are offline. Connect to the internet first.");
    return;
  }

  try {
    await dbReady;
    setSyncButtonState(true, "Loading...");

    const { data, error } = await supabaseClient
      .from("jericho_records")
      .select("*")
      .in("store_name", SYNC_STORES)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    const groupedCloudRecords = {};

    SYNC_STORES.forEach(storeName => {
      groupedCloudRecords[storeName] = [];
    });

    (data || []).forEach(row => {
      if (!groupedCloudRecords[row.store_name]) return;
      groupedCloudRecords[row.store_name].push(recordFromCloud(row));
    });

    for (const storeName of SYNC_STORES) {
      const localRecords = await getAll(storeName);
      const cloudRecords = groupedCloudRecords[storeName] || [];
      const mergedRecords = mergeRecords(localRecords, cloudRecords);

      await replaceStoreRecords(storeName, mergedRecords);
    }

    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    setSyncButtonState(false, "Synced");

    setTimeout(() => {
      setSyncButtonState(false, "Sync");
    }, 2500);

    if (!silent) {
      alert("Downloaded and merged Jericho records from Supabase.");
    }
  } catch (error) {
    console.error("Supabase download failed:", error);
    setSyncButtonState(false, "Retry");

    if (!silent) {
      alert("Could not download records from Supabase. Check your table, key, and RLS policy.");
    }
  }
}

async function syncRecordsToSupabase(options = {}) {
  const silent = options.silent === true;

  if (!supabaseClient) {
    if (!silent) alert("Supabase is not configured correctly.");
    return;
  }

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");
    if (!silent) alert("You are offline. Records will sync when internet is available.");
    return;
  }

  if (syncInProgress) return;

  try {
    await dbReady;

    syncInProgress = true;
    setSyncButtonState(true, "Syncing...");

    const payload = [];

    for (const storeName of SYNC_STORES) {
      const localRecords = await getAll(storeName);

      localRecords.forEach(record => {
        if (record.id === undefined || record.id === null) return;
        payload.push(prepareRecordForCloud(storeName, record));
      });
    }

    if (!payload.length) {
      setSyncButtonState(false, "Sync");
      if (!silent) alert("There are no records to sync.");
      return;
    }

    const { error } = await supabaseClient
      .from("jericho_records")
      .upsert(payload, {
        onConflict: "store_name,local_id"
      });

    if (error) {
      throw error;
    }

    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());

    setSyncButtonState(false, "Synced");

    setTimeout(() => {
      setSyncButtonState(false, "Sync");
    }, 2500);

    if (!silent) {
      alert(`Sync complete. ${payload.length} Jericho record(s) uploaded to Supabase.`);
    }
  } catch (error) {
    console.error("Supabase sync failed:", error);
    setSyncButtonState(false, "Retry");

    if (!silent) {
      alert("Sync failed. Check your Supabase URL, key, table, and RLS policy.");
    }
  } finally {
    syncInProgress = false;
  }
}

function queueAutoSync() {
  if (!supabaseClient) return;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");
    return;
  }

  clearTimeout(syncTimer);

  syncTimer = setTimeout(async () => {
    await pullRecordsFromSupabase({ silent: true });
    await syncRecordsToSupabase({ silent: true });
  }, 1200);
}

function scheduleAutoSync() {
  queueAutoSync();
}

async function syncNow(options = {}) {
  const silent = options.silent === true;

  await pullRecordsFromSupabase({ silent: true });
  await syncRecordsToSupabase({ silent });

  if (typeof refreshAll === "function") {
    await refreshAll();
  }
}

async function deleteEverywhere(storeName, id) {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured correctly.");
  }

  if (!navigator.onLine) {
    throw new Error("You are offline. Connect to the internet before deleting this record.");
  }

  const { error } = await supabaseClient
    .from("jericho_records")
    .delete()
    .eq("store_name", storeName)
    .eq("local_id", String(id));

  if (error) {
    throw error;
  }

  await deleteRecord(storeName, id);
}

function startAutoSync() {
  if (autoSyncStarted) return;

  autoSyncStarted = true;

  window.addEventListener("online", () => {
    setSyncButtonState(false, "Syncing...");
    queueAutoSync();
  });

  window.addEventListener("offline", () => {
    setSyncButtonState(false, "Offline");
  });

  if (navigator.onLine) {
    queueAutoSync();
  } else {
    setSyncButtonState(false, "Offline");
  }
}

window.pullRecordsFromSupabase = pullRecordsFromSupabase;
window.syncRecordsToSupabase = syncRecordsToSupabase;
window.queueAutoSync = queueAutoSync;
window.scheduleAutoSync = scheduleAutoSync;
window.syncNow = syncNow;
window.startAutoSync = startAutoSync;
window.deleteEverywhere = deleteEverywhere;