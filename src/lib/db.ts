import type { VideoRecord } from '../types'

const DB_NAME = 'viralyantra-ai'
const DB_VERSION = 1
const RECORDS = 'records'
const BLOBS = 'blobs'
const LS_FALLBACK = 'viralyantra.records.fallback'

let dbPromise: Promise<IDBDatabase> | null = null

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) return Promise.reject(new Error('IndexedDB is not available'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open local database'))
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = run(transaction.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Local database request failed'))
      })
  )
}

function readFallback(): VideoRecord[] {
  try {
    const raw = localStorage.getItem(LS_FALLBACK)
    return raw ? (JSON.parse(raw) as VideoRecord[]) : []
  } catch {
    return []
  }
}

function writeFallback(records: VideoRecord[]) {
  try {
    localStorage.setItem(LS_FALLBACK, JSON.stringify(records.slice(0, 60)))
  } catch {
    /* storage may be full or disabled */
  }
}

export async function saveRecord(record: VideoRecord, blob?: Blob | null): Promise<void> {
  if (hasIndexedDb()) {
    try {
      await tx(RECORDS, 'readwrite', (s) => s.put(record))
      if (blob) await tx(BLOBS, 'readwrite', (s) => s.put({ id: record.id, blob }))
      return
    } catch {
      /* fall through to localStorage metadata */
    }
  }
  const records = [record, ...readFallback().filter((r) => r.id !== record.id)]
  writeFallback(records)
}

export async function listRecords(): Promise<VideoRecord[]> {
  if (hasIndexedDb()) {
    try {
      const records = await tx<VideoRecord[]>(RECORDS, 'readonly', (s) => s.getAll())
      return records.sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      /* fall through */
    }
  }
  return readFallback().sort((a, b) => b.createdAt - a.createdAt)
}

export async function getRecord(id: string): Promise<VideoRecord | undefined> {
  if (hasIndexedDb()) {
    try {
      return await tx<VideoRecord | undefined>(RECORDS, 'readonly', (s) => s.get(id))
    } catch {
      /* fall through */
    }
  }
  return readFallback().find((r) => r.id === id)
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  if (!hasIndexedDb()) return undefined
  try {
    const entry = await tx<{ id: string; blob: Blob } | undefined>(BLOBS, 'readonly', (s) => s.get(id))
    return entry?.blob
  } catch {
    return undefined
  }
}

export async function deleteRecord(id: string): Promise<void> {
  if (hasIndexedDb()) {
    try {
      await tx(BLOBS, 'readwrite', (s) => s.delete(id))
      await tx(RECORDS, 'readwrite', (s) => s.delete(id))
      return
    } catch {
      /* fall through */
    }
  }
  writeFallback(readFallback().filter((r) => r.id !== id))
}

export async function clearRecords(): Promise<void> {
  if (hasIndexedDb()) {
    try {
      await tx(BLOBS, 'readwrite', (s) => s.clear())
      await tx(RECORDS, 'readwrite', (s) => s.clear())
      return
    } catch {
      /* fall through */
    }
  }
  writeFallback([])
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate()
      return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
    } catch {
      return null
    }
  }
  return null
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    try {
      return await navigator.storage.persist()
    } catch {
      return false
    }
  }
  return false
}
