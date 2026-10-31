import { Injectable } from '@angular/core';
import { StoredLine } from './line';

/**
 * Scrollback persistence in IndexedDB.
 *
 * Deliberately dependency-free: the API is only a handful of calls deep, and a
 * library would add a runtime dep to a prototype for no real gain.
 *
 * Every failure path degrades to "does not persist" rather than throwing. A
 * blocked upgrade, a full quota or a browser without IndexedDB (jsdom in unit
 * tests, Safari private mode) must not stop the terminal from being typeable,
 * so the store never rejects and logs once instead.
 */
@Injectable({ providedIn: 'root' })
export class HistoryStore {
  private static readonly DB_NAME = 'mpdev-terminal';
  private static readonly DB_VERSION = 1;
  private static readonly STORE = 'history';
  /** Lines pulled back on startup; the log is walked from the newest key down. */
  private static readonly LOAD_LIMIT = 300;
  /** Hard ceiling so a long session cannot grow the database without bound. */
  private static readonly MAX_LINES = 2000;

  private database?: Promise<IDBDatabase | null>;

  /** The newest `limit` lines, oldest first. Empty when persistence is unavailable. */
  async load(limit: number = HistoryStore.LOAD_LIMIT): Promise<StoredLine[]> {
    const db = await this.open();
    if (!db) return [];

    return new Promise((resolve) => {
      const rows: StoredLine[] = [];
      const tx = db.transaction(HistoryStore.STORE, 'readonly');
      // A single settle path: whatever stops the walk, the transaction still completes.
      tx.oncomplete = () => resolve(rows.reverse());
      tx.onerror = () => resolve(rows.reverse());
      tx.onabort = () => resolve(rows.reverse());

      const cursorRequest = tx.objectStore(HistoryStore.STORE).openCursor(null, 'prev');
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || rows.length >= limit) return;
        rows.push(cursor.value);
        cursor.continue();
      };
    });
  }

  async append(lines: readonly StoredLine[]): Promise<void> {
    if (lines.length === 0) return;
    const db = await this.open();
    if (!db) return;

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(HistoryStore.STORE, 'readwrite');
        const store = tx.objectStore(HistoryStore.STORE);
        for (const line of lines) {
          // seq is omitted on purpose so autoIncrement assigns it.
          store.add({ text: line.text, kind: line.kind, at: line.at });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      await this.trim();
    } catch (error) {
      console.warn('[terminal] history could not be persisted', error);
    }
  }

  /** Open once and reuse: every call would otherwise re-run the upgrade dance. */
  private open(): Promise<IDBDatabase | null> {
    this.database ??= new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(HistoryStore.DB_NAME, HistoryStore.DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(HistoryStore.STORE)) {
          db.createObjectStore(HistoryStore.STORE, { keyPath: 'seq', autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onblocked = () => console.warn('[terminal] IndexedDB upgrade blocked by another tab');
      request.onerror = () => {
        console.warn('[terminal] IndexedDB unavailable, history will not persist', request.error);
        resolve(null);
      };
    });
    return this.database;
  }

  /** Drop the oldest rows past MAX_LINES, walking forward from the lowest key. */
  private async trim(): Promise<void> {
    const db = await this.open();
    if (!db) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(HistoryStore.STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();

      const store = tx.objectStore(HistoryStore.STORE);
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        const excess = countRequest.result - HistoryStore.MAX_LINES;
        if (excess <= 0) return;
        let removed = 0;
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || removed >= excess) return;
          cursor.delete();
          removed += 1;
          cursor.continue();
        };
      };
    });
  }
}
