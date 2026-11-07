import type { Store } from '@tauri-apps/plugin-store';
import { isWebBuild } from '../api/runtime';

interface StoreLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

class MemoryStore implements StoreLike {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async save(): Promise<void> {}
}

let browserDatabase: Promise<IDBDatabase> | undefined;

async function openBrowserStore(fileName: string): Promise<StoreLike> {
  browserDatabase ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('coolapk-web', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('values');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const database = await browserDatabase;
  return {
    async get<T>(key: string) {
      return new Promise<T | undefined>((resolve, reject) => {
        const request = database.transaction('values').objectStore('values').get([fileName, key]);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error);
      });
    },
    async set(key: string, value: unknown) {
      // 与 Tauri Store 一样只接受可序列化数据，避免 Vue Proxy 无法被 IndexedDB 克隆。
      const snapshot = JSON.parse(JSON.stringify(value));
      return new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('values', 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.objectStore('values').put(snapshot, [fileName, key]);
      });
    },
    async save() {},
  };
}

const stores = new Map<string, Promise<StoreLike>>();
const operationQueues = new Map<string, Promise<unknown>>();

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function loadStore(fileName: string): Promise<StoreLike> {
  const existing = stores.get(fileName);
  if (existing) return existing;

  const promise = (async () => {
    if (isWebBuild) {
      try { return await openBrowserStore(fileName); }
      catch { return new MemoryStore(); }
    }
    if (!isTauriRuntime()) return new MemoryStore();
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      return await Store.load(fileName, { autoSave: false }) as Store;
    } catch (error) {
      console.warn(`加载 ${fileName} 失败，当前会话改用内存存储:`, error);
      return new MemoryStore();
    }
  })();
  stores.set(fileName, promise);
  return promise;
}

function enqueue<T>(fileName: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationQueues.get(fileName) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  operationQueues.set(fileName, next.catch(() => undefined));
  return next;
}

export function readTauriStoreValue<T>(fileName: string, key: string): Promise<T | undefined> {
  return enqueue(fileName, async () => {
    const store = await loadStore(fileName);
    return store.get<T>(key);
  });
}

export function writeTauriStoreValue(fileName: string, key: string, value: unknown): Promise<void> {
  return enqueue(fileName, async () => {
    const store = await loadStore(fileName);
    await store.set(key, value);
    await store.save();
  });
}

export function updateTauriStoreValue<T>(fileName: string, key: string, fallback: T, updater: (value: T) => T): Promise<T> {
  return enqueue(fileName, async () => {
    const store = await loadStore(fileName);
    const current = (await store.get<T>(key)) ?? fallback;
    const updated = updater(current);
    await store.set(key, updated);
    await store.save();
    return updated;
  });
}
