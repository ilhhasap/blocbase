/**
 * Keeps the shrunk screenshot of each Mimic row in the browser's IndexedDB (localStorage is too small for
 * pictures), so Clone again still works after the page is reloaded. Every call fails quietly: with storage
 * blocked the board simply asks for the screenshot again, as it did before.
 */
const DB = "block-supply-mimic-shots";
const STORE = "shots";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no indexedDB"));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = work(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function saveShot(key: string, value: unknown): Promise<void> {
  try {
    await run("readwrite", (store) => store.put(value, key));
  } catch {
    /* storage can be blocked or full */
  }
}

export async function loadShot(key: string): Promise<unknown> {
  try {
    return (await run("readonly", (store) => store.get(key))) ?? null;
  } catch {
    return null;
  }
}

/** Drops every stored picture under `prefix` whose id is not in `keep` (the id follows the prefix). */
export async function pruneShots(prefix: string, keep: Set<string>): Promise<void> {
  try {
    const keys = (await run("readonly", (store) => store.getAllKeys())) as IDBValidKey[];
    for (const key of keys) {
      if (typeof key !== "string" || !key.startsWith(prefix)) continue;
      if (!keep.has(key.slice(prefix.length)))
        await run("readwrite", (store) => store.delete(key));
    }
  } catch {
    /* ignore */
  }
}
