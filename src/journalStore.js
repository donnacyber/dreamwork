// ─── JOURNAL STORAGE (IndexedDB) ────────────────────────────────────────────
// The journal used to live entirely in localStorage, as one big JSON blob
// re-read and re-written on every single save. That's what caused storage
// to fill up and the app to fail to open once a device's localStorage quota
// (typically 5–10MB) was reached: the more dreams saved, the bigger that one
// blob got, and the slower and more failure-prone every save became.
//
// IndexedDB fixes both problems. Its quota is tied to actual free disk
// space (realistically gigabytes, not megabytes), and it stores each
// journal entry as its own record, so adding or editing one dream only
// touches that one record — not the whole journal.
//
// Everything here still lives only on this device. Nothing about this
// change sends anything anywhere.

const DB_NAME = 'dreamwork_db';
const DB_VERSION = 1;
const STORE_NAME = 'journal';

// The key this app used to store the whole journal under, back when it
// lived in localStorage. Only read from here now, during the one-time
// migration below.
const LEGACY_KEY = 'dreamwork_journal';
const MIGRATION_FLAG = 'dreamwork_journal_migrated_v1';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Reads every journal entry currently stored.
export async function idbGetAllEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Writes (or overwrites) a single entry. Used for every normal save —
// adding a new dream, editing one, updating its title or date — so only
// the entry that actually changed gets touched.
export async function idbPutEntry(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Removes a single entry by id.
export async function idbDeleteEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Writes a whole batch of entries in one transaction, without clearing what's
// already there — used by Import. An incoming entry with the same id as one
// already stored simply overwrites it, so importing the same export file
// twice is harmless rather than creating duplicates.
export async function idbUpsertMany(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    entries.forEach(e => store.put(e));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// One-time move of any journal still sitting in the old localStorage key
// into IndexedDB. Safe to call on every app load — after the first
// successful run it does nothing, forever.
export async function migrateLegacyJournalIfNeeded() {
  try {
    if (localStorage.getItem(MIGRATION_FLAG) === 'true') return;

    const raw = localStorage.getItem(LEGACY_KEY);
    const legacyEntries = raw ? JSON.parse(raw) : [];

    if (legacyEntries.length > 0) {
      await idbUpsertMany(legacyEntries);
    }

    // Only mark migration done, and only clear the old blob, once the
    // write above has actually succeeded — so a failed migration leaves
    // the original data untouched and simply tries again next load.
    localStorage.setItem(MIGRATION_FLAG, 'true');
    localStorage.removeItem(LEGACY_KEY);
  } catch (e) {
    console.error('Journal migration to IndexedDB failed, will retry next load', e);
  }
}
