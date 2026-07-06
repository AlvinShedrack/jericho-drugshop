const SUPABASE_URL = "https://rorqfxjnupdnqzcozeut.supabase.co";
const SUPABASE_KEY = "sb_publishable_ZCCvcvPKoSDuY4JpRgwghw_Wt35MjBx";

if (!window.supabase) {
  throw new Error("Supabase library is not loaded. Check your script order.");
}

window.cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

function getRecordTimestamp(recordOrRow, fallbackDate = null) {
  const record = recordOrRow?.data || recordOrRow;
  const value = record?.updatedAt || record?.createdAt || recordOrRow?.updated_at || fallbackDate || 0;
  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function setSyncStatus(message) {
  const syncStatusText = document.getElementById("syncStatusText");

  if (syncStatusText) {
    syncStatusText.textContent = message;
  }

  if (typeof showToast === "function") {
    try {
      showToast(message);
    } catch (error) {
      console.log("Toast skipped:", message);
    }
  } else {
    console.log("Sync:", message);
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
  const recordId = record?.id ?? record?.local_id ?? null;

  const cleanRecord = {
    ...record,
    id: recordId,
    updatedAt: record.updatedAt || record.createdAt || now
  };

  return {
    store_name: storeName,
    local_id: recordId === null || recordId === undefined || recordId === "" ? "" : String(recordId),
    device_id: getDeviceId(),
    data: cleanRecord,
    updated_at: cleanRecord.updatedAt,
    deleted: false
  };
}

async function getCloudRow(storeName, localId) {
  const { data, error } = await window.cloudClient
    .from("cloud_records")
    .select("*")
    .eq("store_name", storeName)
    .eq("local_id", String(localId))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function saveCloudRow(row) {
  const existingRow = await getCloudRow(row.store_name, row.local_id);
  if (existingRow) {
    const existingTime = getRecordTimestamp(existingRow, existingRow.updated_at);
    const newTime = getRecordTimestamp(row, row.updated_at);

    if (existingTime > newTime) {
      return;
    }

    if (existingTime === newTime) {
      if (existingRow.deleted === row.deleted) {
        return;
      }
      if (existingRow.deleted && !row.deleted) {
        return;
      }
    }
  }

  const { error } = await window.cloudClient
    .from("cloud_records")
    .upsert([row], {
      onConflict: "store_name,local_id",
      defaultToNull: false
    });

  if (error) {
    throw error;
  }
}

async function markCloudRecordDeleted(storeName, id) {
  const now = new Date().toISOString();

  const deletedRow = {
    store_name: storeName,
    local_id: String(id),
    device_id: getDeviceId(),
    data: {
      id: Number(id),
      deletedAt: now,
      updatedAt: now
    },
    updated_at: now,
    deleted: true
  };

  await saveCloudRow(deletedRow);
}

async function getRemoteDeletionTimestamps(storeName) {
  const { data, error } = await window.cloudClient
    .from("cloud_records")
    .select("local_id, updated_at")
    .eq("store_name", storeName)
    .eq("deleted", true);

  if (error) {
    throw error;
  }

  const tombstoneTimes = {};
  for (const row of data || []) {
    const rowId = row?.local_id;
    if (rowId === undefined || rowId === null || rowId === "") {
      continue;
    }

    const timestamp = getRecordTimestamp(row, row.updated_at);
    const key = String(rowId);
    tombstoneTimes[key] = Math.max(tombstoneTimes[key] || 0, timestamp);
  }

  return tombstoneTimes;
}

async function deleteEverywhere(storeName, id) {
  const now = new Date().toISOString();

  // First mark it deleted in Supabase
  if (navigator.onLine && typeof markCloudRecordDeleted === "function") {
    await markCloudRecordDeleted(storeName, id);
  } else {
    throw new Error("You are offline. Connect to internet before deleting this record.");
  }

  // Then delete it locally
  await deleteRecord(storeName, id);

  return now;
}
async function pullCloudStoreToLocal(storeName) {
  const deletionTimestamps = await getRemoteDeletionTimestamps(storeName);

  const { data, error } = await window.cloudClient
    .from("cloud_records")
    .select("*")
    .eq("store_name", storeName)
    .order("updated_at", { ascending: true });

  if (error) {
    throw error;
  }

  let imported = 0;

  for (const row of data || []) {
    const rowId = row?.local_id;

    if (row.deleted) {
      const localRecord = rowId !== undefined && rowId !== null && rowId !== ""
        ? await getById(storeName, rowId)
        : null;
      const localTime = localRecord ? getRecordTime(localRecord) : 0;
      const tombstoneTime = getRecordTimestamp(row, row.updated_at);

      if (!localRecord) {
        imported++;
        continue;
      }

      if (localTime > tombstoneTime) {
        await saveCloudRow(prepareRecordForCloud(storeName, localRecord));
      } else {
        await deleteRecord(storeName, rowId);
      }

      imported++;
      continue;
    }

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
      const tombstoneTime = deletionTimestamps[String(cloudRecord.id)];
      const cloudTime = getRecordTimestamp(row, row.updated_at);

      if (tombstoneTime && tombstoneTime >= cloudTime) {
        continue;
      }

      await putRecord(storeName, cloudRecord);
      imported++;
      continue;
    }

    const localTime = getRecordTime(localRecord);
    const cloudTime = getRecordTimestamp(row, row.updated_at);

    if (cloudTime > localTime) {
      const tombstoneTime = deletionTimestamps[String(cloudRecord.id)];
      if (tombstoneTime && tombstoneTime >= cloudTime) {
        continue;
      }

      await putRecord(storeName, cloudRecord);
      imported++;
    } else if (localTime > cloudTime) {
      await saveCloudRow(prepareRecordForCloud(storeName, localRecord));
      imported++;
    }
  }

  return imported;
}

async function pullCloudDeletionsFirst(storeName) {
  const { data, error } = await window.cloudClient
    .from("cloud_records")
    .select("*")
    .eq("store_name", storeName)
    .eq("deleted", true)
    .order("updated_at", { ascending: true });

  if (error) {
    throw error;
  }

  let processed = 0;

  for (const row of data || []) {
    const rowId = row?.local_id;
    if (rowId === undefined || rowId === null || rowId === "") {
      continue;
    }

    const localRecord = await getById(storeName, rowId);
    if (!localRecord) {
      processed++;
      continue;
    }

    const localTime = getRecordTime(localRecord);
    const tombstoneTime = getRecordTimestamp(row, row.updated_at);

    if (localTime > tombstoneTime) {
      await saveCloudRow(prepareRecordForCloud(storeName, localRecord));
    } else {
      await deleteRecord(storeName, rowId);
    }

    processed++;
  }

  return processed;
}

async function pushLocalStoreToCloud(storeName) {
  const localRecords = await getAll(storeName);

  const cloudRows = localRecords
    .filter(record => record.id !== undefined && record.id !== null)
    .map(record => prepareRecordForCloud(storeName, record));

  if (!cloudRows.length) {
    return 0;
  }

  for (const row of cloudRows) {
    await saveCloudRow(row);
  }

  return cloudRows.length;
}

async function pullAllCloudDataFirst() {
  let pulled = 0;

  for (const storeName of SYNC_STORES) {
    pulled += await pullCloudDeletionsFirst(storeName);
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
  updateSyncButtons("Applying cloud deletions first...", true);
  setSyncStatus("Applying cloud deletions first...");

  try {
    // 1. Apply remote deletions before pushing local records
    const pulledDeletions = await Promise.all(SYNC_STORES.map(storeName => pullCloudDeletionsFirst(storeName)));
    const deletedCount = pulledDeletions.reduce((sum, value) => sum + value, 0);

    updateSyncButtons("Uploading local changes...", true);
    setSyncStatus("Uploading local changes...");

    // 2. Upload local changes after remote tombstones are applied
    const pushed = await pushAllLocalData();

    // 3. Then download all cloud data to reconcile any remaining updates
    updateSyncButtons("Downloading latest cloud data...", true);
    setSyncStatus("Downloading latest cloud data...");

    const pulled = await pullAllCloudDataFirst();

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    const now = new Date().toLocaleString();
    localStorage.setItem(LAST_SYNC_KEY, now);

    const message = `Sync complete. Uploaded ${pushed}, downloaded ${pulled}. Last sync: ${now}`;

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

