/*
 * My Rx Pharmacy - FIXED SYNC.JS
 *
 * IMPORTANT:
 * - This file replaces the old sync.js.
 * - It keeps localStorage sync state.
 * - It performs real automatic synchronization.
 * - It uses a stable syncId for cross-device identity.
 * - It does not clear IndexedDB during a normal cloud download.
 * - It keeps deleted records as cloud tombstones.
 *
 * SUPABASE:
 * The RPC sync_jericho_record_replace must accept:
 *   p_store_name
 *   p_local_id
 *   p_device_id
 *   p_data
 *   p_updated_at
 *
 * p_local_id should be treated as the stable syncId, not as the
 * browser-specific IndexedDB numeric id.
 */

console.log("SYNC.JS LOADED - FIXED AUTO SYNC");

const JERICHO_SUPABASE_URL =
  "https://rorqfxjnupdnqzcozeut.supabase.co";

const JERICHO_SUPABASE_PUBLIC_KEY =
  "sb_publishable_ZCCvcvPKoSDuY4JpRgwghw_Wt35MjBx";

const JERICHO_SYNC_TABLE = "jericho_records";

const JERICHO_SYNC_STORES = [
  "users",
  "suppliers",
  "medicines",
  "batches",
  "sales",
  "purchases",
  "expenses",
  "auditLogs"
];

const JERICHO_DEVICE_ID_KEY = "jericho_device_id";
const JERICHO_LAST_SYNC_KEY = "jericho_last_supabase_sync_at";
const JERICHO_LOCAL_CHANGES_KEY = "jericho_manual_has_changes_v2";
const JERICHO_DIRTY_RECORDS_KEY = "jericho_manual_dirty_records_v2";
const JERICHO_PENDING_DELETES_KEY = "jericho_manual_pending_deletes_v2";

window.__jerichoSyncBusy = false;
window.__jerichoAutoSyncReady = false;
window.__jerichoApplyingRemote = false;
window.__jerichoSuppressWriteTracking = false;
window.__jerichoWriteTrackingPatched = false;
window.__jerichoAutoSyncTimer = null;
window.__jerichoAutoSyncInterval = null;

if (!window.supabase) {
  alert(
    "Supabase library is not loaded. " +
    "Make sure the Supabase script is loaded before sync.js."
  );
  throw new Error("Supabase library is not loaded.");
}

function getJerichoCloud() {
  if (
    !window.supabase ||
    typeof window.supabase.createClient !== "function"
  ) {
    throw new Error("Supabase library is not loaded correctly.");
  }

  if (
    !window.cloudClient ||
    typeof window.cloudClient.from !== "function"
  ) {
    window.cloudClient = window.supabase.createClient(
      JERICHO_SUPABASE_URL,
      JERICHO_SUPABASE_PUBLIC_KEY
    );
  }

  return window.cloudClient;
}

/* -----------------------------------------------------------
   DEVICE ID
----------------------------------------------------------- */

function getJerichoDeviceId() {
  let id = localStorage.getItem(JERICHO_DEVICE_ID_KEY);

  if (!id) {
    id =
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "device_" +
          Date.now() +
          "_" +
          Math.random().toString(16).slice(2);

    localStorage.setItem(JERICHO_DEVICE_ID_KEY, id);
  }

  return id;
}

const jerichoDeviceId = getJerichoDeviceId();

/* -----------------------------------------------------------
   SAFE LOCAL STORAGE
----------------------------------------------------------- */

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "");
    return value == null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function markLocalChanges() {
  localStorage.setItem(JERICHO_LOCAL_CHANGES_KEY, "true");
}

function clearLocalChanges() {
  localStorage.removeItem(JERICHO_LOCAL_CHANGES_KEY);
}

function hasLocalChanges() {
  return (
    localStorage.getItem(JERICHO_LOCAL_CHANGES_KEY) === "true"
  );
}

function getDirtyMap() {
  const value = readJson(JERICHO_DIRTY_RECORDS_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function saveDirtyMap(value) {
  writeJson(JERICHO_DIRTY_RECORDS_KEY, value || {});
}

function clearDirtyMap() {
  localStorage.removeItem(JERICHO_DIRTY_RECORDS_KEY);
}

function getPendingDeletes() {
  const value = readJson(JERICHO_PENDING_DELETES_KEY, []);
  return Array.isArray(value) ? value : [];
}

function savePendingDeletes(value) {
  writeJson(JERICHO_PENDING_DELETES_KEY, value || []);
}

function clearPendingDeletes() {
  localStorage.removeItem(JERICHO_PENDING_DELETES_KEY);
}

/* -----------------------------------------------------------
   HELPERS
----------------------------------------------------------- */

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isDeletedRecord(record) {
  return (
    record &&
    (
      record._deleted === true ||
      String(record._deleted).toLowerCase() === "true"
    )
  );
}

function makeSyncId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    "sync_" +
    Date.now() +
    "_" +
    Math.random().toString(36).slice(2) +
    "_" +
    Math.random().toString(36).slice(2)
  );
}

function ensureSyncId(record) {
  const copy = { ...(record || {}) };

  if (!copy.syncId) {
    copy.syncId = makeSyncId();
  }

  return copy;
}

function getRecordTime(record) {
  const value =
    record?.updatedAt ||
    record?.createdAt ||
    record?.deletedAt ||
    0;

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function getRecordIdentityKey(storeName, record) {
  if (!record) return null;

  if (record.syncId) {
    return storeName + ":sync:" + String(record.syncId);
  }

  if (storeName === "users") {
    const email = normalizeText(record.email);

    if (email) {
      return storeName + ":email:" + email;
    }
  }

  if (storeName === "suppliers") {
    const name = normalizeText(
      record.supplierName ||
      record.companyName ||
      record.name
    );

    if (name) {
      return storeName + ":name:" + name;
    }
  }

  if (
    record.id !== undefined &&
    record.id !== null &&
    record.id !== ""
  ) {
    return storeName + ":id:" + String(record.id);
  }

  return null;
}

/* -----------------------------------------------------------
   UI
----------------------------------------------------------- */

function setSyncButtonState(isSyncing, text) {
  document.querySelectorAll(".sync-now-btn").forEach(button => {
    button.disabled = Boolean(isSyncing);
    button.style.pointerEvents = "auto";
    button.style.cursor = isSyncing ? "wait" : "pointer";

    if (isSyncing) {
      button.textContent = "Syncing...";
    } else {
      button.textContent = text || "Sync Now";
    }
  });

  const status = document.getElementById("syncStatusText");

  if (status) {
    status.textContent = text || "";
  }

  console.log("SYNC STATUS:", text);
}

function showSyncMessage(message) {
  console.log("SYNC:", message);

  if (typeof showToast === "function") {
    try {
      showToast(message);
    } catch (error) {
      console.warn("showToast failed:", error);
    }
  }
}

function showRealError(stage, error) {
  console.error(stage, error);

  const message =
    "SYNC FAILED\n\n" +
    "Stage: " + stage + "\n\n" +
    "Message: " + (error?.message || "No message") + "\n\n" +
    "Code: " + (error?.code || "No code") + "\n\n" +
    "Details: " + (error?.details || "No details") + "\n\n" +
    "Hint: " + (error?.hint || "No hint");

  alert(message);
}

/* -----------------------------------------------------------
   DIRTY TRACKING
----------------------------------------------------------- */

function markDirtyRecord(storeName, record, deleted = false) {
  if (
    window.__jerichoApplyingRemote ||
    window.__jerichoSuppressWriteTracking
  ) {
    return;
  }

  if (!storeName || !record) return;

  const clean = ensureSyncId(record);

  if (
    clean.id === undefined ||
    clean.id === null ||
    clean.id === ""
  ) {
    return;
  }

  const now = new Date().toISOString();

  clean.updatedAt = clean.updatedAt || now;

  if (deleted) {
    clean._deleted = true;
    clean.deletedAt = clean.deletedAt || now;
  }

  const dirty = getDirtyMap();

  const key =
    storeName + ":" + String(clean.syncId);

  dirty[key] = {
    storeName,
    id: clean.id,
    syncId: clean.syncId,
    deleted: Boolean(deleted),
    record: clean
  };

  saveDirtyMap(dirty);
  markLocalChanges();

  scheduleAutoSync();
}

function addPendingDelete(storeName, record) {
  if (!storeName || !record) return;

  const clean = ensureSyncId(record);
  const now = new Date().toISOString();

  clean._deleted = true;
  clean.deletedAt = clean.deletedAt || now;
  clean.updatedAt = clean.updatedAt || now;

  const items = getPendingDeletes();

  const key = storeName + ":" + String(clean.syncId);

  const filtered = items.filter(item => {
    return (
      item.storeName + ":" + String(item.syncId) !== key
    );
  });

  filtered.push({
    storeName,
    id: clean.id,
    syncId: clean.syncId,
    record: clean
  });

  savePendingDeletes(filtered);
  markLocalChanges();
}

/* -----------------------------------------------------------
   CLOUD FORMAT
----------------------------------------------------------- */

function prepareRecordForCloud(storeName, record) {
  const clean = ensureSyncId(record);
  const now = new Date().toISOString();

  clean.updatedAt =
    clean.updatedAt ||
    clean.createdAt ||
    now;

  return {
    store_name: storeName,

    /*
     * IMPORTANT:
     * The cloud identity is the stable syncId.
     * Do not use the local IndexedDB numeric id here.
     */
    local_id: String(clean.syncId),

    device_id: jerichoDeviceId,

    data: clean,

    updated_at: clean.updatedAt,

    synced_at: now
  };
}

function recordFromCloud(row) {
  const data = {
    ...(row?.data || {})
  };

  if (!data.syncId) {
    data.syncId =
      row?.local_id ||
      makeSyncId();
  }

  /*
   * Keep the existing local id when possible.
   * If the cloud record has a numeric id and this device does not
   * have the record yet, the IndexedDB id will be assigned by the
   * caller when needed.
   */
  if (
    data.id === undefined ||
    data.id === null ||
    data.id === ""
  ) {
    if (
      row?.data?.id !== undefined &&
      row?.data?.id !== null
    ) {
      data.id = row.data.id;
    }
  }

  data.updatedAt =
    data.updatedAt ||
    row?.updated_at ||
    row?.synced_at ||
    new Date().toISOString();

  return data;
}

/* -----------------------------------------------------------
   SUPABASE
----------------------------------------------------------- */

async function uploadRecordToCloud(storeName, record) {
  const cloudRecord =
    prepareRecordForCloud(storeName, record);

  console.log(
    "Uploading:",
    storeName,
    cloudRecord.local_id
  );

  const { data, error } =
    await getJerichoCloud().rpc(
      "sync_jericho_record_replace",
      {
        p_store_name: cloudRecord.store_name,
        p_local_id: cloudRecord.local_id,
        p_device_id: cloudRecord.device_id,
        p_data: cloudRecord.data,
        p_updated_at: cloudRecord.updated_at
      }
    );

  if (error) {
    console.error(
      "Supabase RPC error:",
      error
    );

    throw error;
  }

  return data;
}

async function getCloudRows() {
  const { data, error } =
    await getJerichoCloud()
      .from(JERICHO_SYNC_TABLE)
      .select("*")
      .in(
        "store_name",
        JERICHO_SYNC_STORES
      )
      .order(
        "updated_at",
        { ascending: false }
      );

  if (error) {
    throw error;
  }

  return data || [];
}

/* -----------------------------------------------------------
   LOCAL RECORD LOOKUP
----------------------------------------------------------- */

async function findLocalBySyncId(storeName, syncId) {
  if (!syncId) return null;

  const records = await getAll(storeName);

  return (
    records.find(
      record =>
        String(record.syncId || "") ===
        String(syncId)
    ) || null
  );
}

async function findLocalByIdentity(storeName, record) {
  const records = await getAll(storeName);

  const key =
    getRecordIdentityKey(storeName, record);

  if (!key) return null;

  return (
    records.find(
      local =>
        getRecordIdentityKey(
          storeName,
          local
        ) === key
    ) || null
  );
}

/* -----------------------------------------------------------
   SAFE CLOUD MERGE
----------------------------------------------------------- */

async function mergeCloudRecordIntoLocal(
  storeName,
  cloudRecord
) {
  if (!cloudRecord) return;

  const record =
    ensureSyncId(cloudRecord);

  const localBySync =
    await findLocalBySyncId(
      storeName,
      record.syncId
    );

  const local =
    localBySync ||
    await findLocalByIdentity(
      storeName,
      record
    );

  if (isDeletedRecord(record)) {
    if (local) {
      window.__jerichoApplyingRemote = true;

      try {
        await deleteRecord(
          storeName,
          local.id
        );
      } finally {
        window.__jerichoApplyingRemote = false;
      }
    }

    return;
  }

  /*
   * Do not overwrite newer local unsynced data.
   */
  if (local) {
    const localIsDirty =
      Object.values(getDirtyMap()).some(
        item =>
          item.storeName === storeName &&
          String(item.syncId) ===
            String(record.syncId)
      );

    if (
      localIsDirty &&
      getRecordTime(local) >
        getRecordTime(record)
    ) {
      return;
    }

    record.id = local.id;
  } else {
    /*
     * If this is a new cloud record and its id
     * collides with a local id belonging to another
     * record, remove the id so IndexedDB can create
     * a new local key.
     */
    if (
      record.id !== undefined &&
      record.id !== null
    ) {
      const sameId =
        await getById(
          storeName,
          record.id
        );

      if (
        sameId &&
        String(sameId.syncId || "") !==
          String(record.syncId)
      ) {
        delete record.id;
      }
    }
  }

  window.__jerichoApplyingRemote = true;

  try {
    await putRecord(
      storeName,
      record
    );
  } finally {
    window.__jerichoApplyingRemote = false;
  }
}

async function downloadAndMergeFromCloud() {
  const rows =
    await getCloudRows();

  let count = 0;

  for (const row of rows) {
    const storeName =
      row.store_name;

    if (
      !JERICHO_SYNC_STORES.includes(
        storeName
      )
    ) {
      continue;
    }

    const record =
      recordFromCloud(row);

    await mergeCloudRecordIntoLocal(
      storeName,
      record
    );

    count += 1;
  }

  localStorage.setItem(
    JERICHO_LAST_SYNC_KEY,
    new Date().toISOString()
  );

  return count;
}

/* -----------------------------------------------------------
   WRITE TRACKING
----------------------------------------------------------- */

function patchLocalWriteTracking() {
  if (
    window.__jerichoWriteTrackingPatched
  ) {
    return true;
  }

  if (
    typeof window.addRecord !==
      "function" ||
    typeof window.putRecord !==
      "function" ||
    typeof window.deleteRecord !==
      "function"
  ) {
    console.warn(
      "Sync write tracking waiting for IndexedDB functions."
    );

    return false;
  }

  const originalAdd =
    window.addRecord;

  const originalPut =
    window.putRecord;

  const originalDelete =
    window.deleteRecord;

  window.addRecord =
    async function (
      storeName,
      record
    ) {
      const next =
        ensureSyncId(record);

      if (
        !window.__jerichoApplyingRemote &&
        !window.__jerichoSuppressWriteTracking
      ) {
        next.updatedAt =
          new Date().toISOString();
      }

      const id =
        await originalAdd.call(
          this,
          storeName,
          next
        );

      if (
        !window.__jerichoApplyingRemote &&
        !window.__jerichoSuppressWriteTracking
      ) {
        markDirtyRecord(
          storeName,
          {
            ...next,
            id
          },
          false
        );
      }

      return id;
    };

  window.putRecord =
    async function (
      storeName,
      record
    ) {
      const next =
        ensureSyncId(record);

      if (
        !window.__jerichoApplyingRemote &&
        !window.__jerichoSuppressWriteTracking
      ) {
        next.updatedAt =
          new Date().toISOString();
      }

      const result =
        await originalPut.call(
          this,
          storeName,
          next
        );

      if (
        !window.__jerichoApplyingRemote &&
        !window.__jerichoSuppressWriteTracking
      ) {
        markDirtyRecord(
          storeName,
          next,
          isDeletedRecord(next)
        );
      }

      return result;
    };

  window.deleteRecord =
    async function (
      storeName,
      id
    ) {
      let existing = null;

      if (
        !window.__jerichoApplyingRemote &&
        !window.__jerichoSuppressWriteTracking
      ) {
        try {
          existing =
            await getById(
              storeName,
              id
            );
        } catch (error) {
          console.warn(
            "Could not read record before delete:",
            error
          );
        }
      }

      const result =
        await originalDelete.call(
          this,
          storeName,
          id
        );

      if (
        !window.__jerichoApplyingRemote &&
        !window.__jerichoSuppressWriteTracking
      ) {
        if (existing) {
          addPendingDelete(
            storeName,
            existing
          );
        } else {
          addPendingDelete(
            storeName,
            {
              id,
              syncId: makeSyncId()
            }
          );
        }

        scheduleAutoSync();
      }

      return result;
    };

  window.__jerichoWriteTrackingPatched =
    true;

  console.log(
    "SYNC: IndexedDB write tracking installed."
  );

  return true;
}

/* -----------------------------------------------------------
   UPLOAD LOCAL CHANGES
----------------------------------------------------------- */

async function syncRecordsToSupabase(
  options = {}
) {
  const silent =
    options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(
      false,
      "Offline"
    );

    if (!silent) {
      showSyncMessage(
        "Offline. Changes will sync when internet returns."
      );
    }

    return 0;
  }

  await dbReady;

  patchLocalWriteTracking();

  const dirty =
    getDirtyMap();

  const dirtyEntries =
    Object.values(dirty);

  const pendingDeletes =
    getPendingDeletes();

  if (
    !dirtyEntries.length &&
    !pendingDeletes.length
  ) {
    clearLocalChanges();
    return 0;
  }

  setSyncButtonState(
    true,
    "Uploading..."
  );

  let uploaded = 0;

  /*
   * Upload a snapshot of the current dirty queue.
   * The queue is NOT cleared until every upload succeeds.
   */
  for (const item of dirtyEntries) {
    if (
      !item ||
      !item.storeName
    ) {
      continue;
    }

    let record =
      item.record || {};

    if (!item.deleted) {
      try {
        const current =
          await findLocalBySyncId(
            item.storeName,
            item.syncId
          );

        if (current) {
          record = current;
        }
      } catch (error) {
        console.warn(
          "Could not refresh dirty record:",
          error
        );
      }
    }

    await uploadRecordToCloud(
      item.storeName,
      {
        ...record,
        syncId:
          record.syncId ||
          item.syncId,
        _deleted:
          Boolean(item.deleted)
      }
    );

    uploaded += 1;
  }

  /*
   * Upload deletion tombstones.
   */
  for (const item of pendingDeletes) {
    if (
      !item ||
      !item.storeName ||
      !item.record
    ) {
      continue;
    }

    await uploadRecordToCloud(
      item.storeName,
      {
        ...item.record,
        syncId:
          item.record.syncId ||
          item.syncId,
        _deleted: true
      }
    );

    uploaded += 1;
  }

  /*
   * Only clear the queue after ALL uploads succeeded.
   */
  clearDirtyMap();
  clearPendingDeletes();
  clearLocalChanges();

  localStorage.setItem(
    JERICHO_LAST_SYNC_KEY,
    new Date().toISOString()
  );

  return uploaded;
}

/* -----------------------------------------------------------
   DOWNLOAD
----------------------------------------------------------- */

async function freshDownloadFromCloud(
  options = {}
) {
  const silent =
    options.silent === true;

  if (!navigator.onLine) {
    if (!silent) {
      showSyncMessage(
        "Offline. Cannot download cloud data."
      );
    }

    return 0;
  }

  await dbReady;
  patchLocalWriteTracking();

  setSyncButtonState(
    true,
    "Downloading..."
  );

  const count =
    await downloadAndMergeFromCloud();

  if (
    typeof refreshAll ===
    "function"
  ) {
    try {
      await refreshAll();
    } catch (error) {
      console.warn(
        "refreshAll failed after sync:",
        error
      );
    }
  }

  return count;
}

async function pullRecordsFromSupabase(
  options = {}
) {
  return freshDownloadFromCloud(
    options
  );
}

/* -----------------------------------------------------------
   FULL SYNC
----------------------------------------------------------- */

async function syncNow(
  options = {}
) {
  const silent =
    options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(
      false,
      "Offline"
    );

    if (!silent) {
      showSyncMessage(
        "Offline. Changes are saved locally."
      );
    }

    return false;
  }

  if (window.__jerichoSyncBusy) {
    return false;
  }

  window.__jerichoSyncBusy = true;

  try {
    await dbReady;

    /*
     * The application may load IndexedDB functions
     * after sync.js, so try patching every time.
     */
    patchLocalWriteTracking();

    setSyncButtonState(
      true,
      "Uploading..."
    );

    const uploaded =
      await syncRecordsToSupabase({
        silent: true
      });

    setSyncButtonState(
      true,
      "Downloading..."
    );

    const downloaded =
      await freshDownloadFromCloud({
        silent: true
      });

    setSyncButtonState(
      false,
      "Synced"
    );

    console.log(
      "SYNC COMPLETE:",
      {
        uploaded,
        downloaded
      }
    );

    if (!silent) {
      showSyncMessage(
        "Sync complete. " +
        uploaded +
        " uploaded, " +
        downloaded +
        " cloud records checked."
      );
    }

    return true;
  } catch (error) {
    console.error(
      "SYNC FAILED:",
      error
    );

    setSyncButtonState(
      false,
      "Sync failed"
    );

    if (!silent) {
      showRealError(
        "SYNC",
        error
      );
    }

    return false;
  } finally {
    window.__jerichoSyncBusy =
      false;
  }
}

/* -----------------------------------------------------------
   AUTOMATIC SYNC
----------------------------------------------------------- */

function queueAutoSync() {
  markLocalChanges();

  setSyncButtonState(
    false,
    "Sync pending"
  );

  /*
   * Give the application a short delay so multiple writes
   * made during one operation are uploaded together.
   */
  clearTimeout(
    window.__jerichoAutoSyncTimer
  );

  window.__jerichoAutoSyncTimer =
    setTimeout(() => {
      if (navigator.onLine) {
        syncNow({
          silent: true
        });
      }
    }, 1500);
}

function scheduleAutoSync() {
  queueAutoSync();
}

function startAutoSync() {
  patchLocalWriteTracking();

  if (
    window.__jerichoAutoSyncReady
  ) {
    return;
  }

  window.__jerichoAutoSyncReady =
    true;

  /*
   * Retry when the computer comes back online.
   */
  window.addEventListener(
    "online",
    () => {
      console.log(
        "SYNC: Internet connection restored."
      );

      setSyncButtonState(
        false,
        hasLocalChanges()
          ? "Sync pending"
          : "Sync Now"
      );

      if (hasLocalChanges()) {
        setTimeout(
          () => {
            syncNow({
              silent: true
            });
          },
          1000
        );
      } else {
        /*
         * Even without local changes, download
         * newer records from another device.
         */
        setTimeout(
          () => {
            syncNow({
              silent: true
            });
          },
          1000
        );
      }
    }
  );

  window.addEventListener(
    "offline",
    () => {
      setSyncButtonState(
        false,
        "Offline"
      );
    }
  );

  /*
   * Periodic cloud check.
   * This is what the old scheduleAutoSync()
   * was missing.
   */
  clearInterval(
    window.__jerichoAutoSyncInterval
  );

  window.__jerichoAutoSyncInterval =
    setInterval(
      () => {
        if (
          navigator.onLine &&
          !window.__jerichoSyncBusy
        ) {
          syncNow({
            silent: true
          });
        }
      },
      30000
    );

  /*
   * Initial sync.
   */
  setTimeout(
    () => {
      if (navigator.onLine) {
        syncNow({
          silent: true
        });
      }
    },
    2000
  );

  setSyncButtonState(
    false,
    navigator.onLine
      ? (
          hasLocalChanges()
            ? "Sync pending"
            : "Sync Now"
        )
      : "Offline"
  );
}

/* -----------------------------------------------------------
   DELETE EVERYWHERE
----------------------------------------------------------- */

async function deleteEverywhere(
  storeName,
  id
) {
  await dbReady;

  patchLocalWriteTracking();

  const record =
    await getById(
      storeName,
      id
    );

  if (!record) {
    console.warn(
      "Delete requested but record was not found:",
      storeName,
      id
    );

    return;
  }

  /*
   * Save tombstone BEFORE deleting local data.
   */
  addPendingDelete(
    storeName,
    record
  );

  window.__jerichoSuppressWriteTracking =
    true;

  try {
    await deleteRecord(
      storeName,
      id
    );
  } finally {
    window.__jerichoSuppressWriteTracking =
      false;
  }

  markLocalChanges();
  scheduleAutoSync();

  if (
    typeof refreshAll ===
    "function"
  ) {
    await refreshAll();
  }
}

/* -----------------------------------------------------------
   BUTTONS
----------------------------------------------------------- */

function bindSyncButtons() {
  document
    .querySelectorAll(
      ".sync-now-btn"
    )
    .forEach(button => {
      button.disabled = false;
      button.style.pointerEvents =
        "auto";
      button.style.cursor =
        "pointer";
    });
}

document.addEventListener(
  "click",
  async event => {
    const button =
      event.target.closest(
        ".sync-now-btn"
      );

    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    await syncNow({
      silent: false
    });
  },
  true
);

/* -----------------------------------------------------------
   STARTUP
----------------------------------------------------------- */

document.addEventListener(
  "DOMContentLoaded",
  () => {
    bindSyncButtons();

    /*
     * IndexedDB functions may already exist.
     * If they do not, startAutoSync() will try again
     * whenever the app calls it.
     */
    patchLocalWriteTracking();
    startAutoSync();
  }
);

/*
 * Also expose a startup function for index.js/app.js.
 *
 * Recommended:
 *
 *   startAutoSync();
 *
 * after the IndexedDB functions are defined.
 */
window.pullRecordsFromSupabase =
  pullRecordsFromSupabase;

window.syncRecordsToSupabase =
  syncRecordsToSupabase;

window.queueAutoSync =
  queueAutoSync;

window.scheduleAutoSync =
  scheduleAutoSync;

window.syncNow =
  syncNow;

window.startAutoSync =
  startAutoSync;

window.deleteEverywhere =
  deleteEverywhere;

console.log(
  "SYNC.JS READY - AUTO SYNC ENABLED"
);
