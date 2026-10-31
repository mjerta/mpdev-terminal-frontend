import { Injectable } from '@angular/core';

/** One remembered command. `seq` is filled in by IndexedDB's autoIncrement. */
export interface StoredCommand {
  readonly text: string;
  readonly at: number;
  readonly seq?: number;
}

/**
 * The command history, persisted.
 *
 * This holds what `history` lists and what `up` will recall: the commands you
 * typed, independently of what is on screen. That separation is the whole point
 * - `clear` erases the display and must not touch any of this, which is also how
 * a real shell behaves, since its history lives in a file rather than in the
 * terminal's scrollback.
 *
 * Deliberately dependency-free: the API is a handful of calls deep and a library
 * would add a runtime dep to a prototype for no gain.
 *
 * Every failure path degrades to "does not persist" rather than throwing. A
 * blocked upgrade, a full quota or a browser without IndexedDB (jsdom in unit
 * tests, Safari private mode) must not stop the terminal from being typeable, so
 * the store never rejects and logs once instead.
 */
@Injectable({ providedIn: 'root' })
export class CommandStore {
  private static readonly DB_NAME = 'mpdev-terminal';
  private static readonly DB_VERSION = 2;
  private static readonly STORE = 'commands';
  /** Ceiling on the log, roughly bash's HISTFILESIZE, so it cannot grow forever. */
  private static readonly MAX_COMMANDS = 2000;

  private database?: Promise<IDBDatabase | null>;

  /** Every remembered command, oldest first. Empty when persistence is unavailable. */
  async load(): Promise<StoredCommand[]> {
    const db = await this.open();
    if (!db) return [];

    return new Promise((resolve) => {
      const rows: StoredCommand[] = [];
      const tx = db.transaction(CommandStore.STORE, 'readonly');
      // A single settle path: whatever stops the walk, the transaction completes.
      tx.oncomplete = () => resolve(rows.reverse());
      tx.onerror = () => resolve(rows.reverse());
      tx.onabort = () => resolve(rows.reverse());

      // Walking from the newest key keeps the read bounded by MAX_COMMANDS
      // instead of pulling the whole log to slice the tail off it.
      const cursorRequest = tx.objectStore(CommandStore.STORE).openCursor(null, 'prev');
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || rows.length >= CommandStore.MAX_COMMANDS) return;
        rows.push(cursor.value);
        cursor.continue();
      };
    });
  }

  async append(text: string): Promise<void> {
    const db = await this.open();
    if (!db) return;

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CommandStore.STORE, 'readwrite');
        // seq is omitted so autoIncrement assigns it.
        tx.objectStore(CommandStore.STORE).add({ text, at: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      await this.trim();
    } catch (error) {
      console.warn('[terminal] command could not be persisted', error);
    }
  }

  /**
   * v2 introduces `commands` and drops `history`, the earlier store that held
   * rendered scrollback lines. Nothing reads it any more, and leaving it behind
   * would mean a live database whose name promises something the app no longer
   * does.
   */
  private open(): Promise<IDBDatabase | null> {
    this.database ??= new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(CommandStore.DB_NAME, CommandStore.DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CommandStore.STORE)) {
          db.createObjectStore(CommandStore.STORE, { keyPath: 'seq', autoIncrement: true });
        }
        if (db.objectStoreNames.contains('history')) {
          db.deleteObjectStore('history');
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

  /** Drop the oldest commands past MAX_COMMANDS, walking up from the lowest key. */
  private async trim(): Promise<void> {
    const db = await this.open();
    if (!db) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(CommandStore.STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();

      const store = tx.objectStore(CommandStore.STORE);
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        const excess = countRequest.result - CommandStore.MAX_COMMANDS;
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
