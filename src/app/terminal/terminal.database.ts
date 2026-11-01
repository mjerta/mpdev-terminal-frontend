import { Injectable } from '@angular/core';

/**
 * Owns the terminal's single IndexedDB database.
 *
 * Both stores live here on purpose. If each service opened the database itself
 * and declared its own store in `onupgradeneeded`, then whichever service loaded
 * first on a brand-new install would create only its own store, and the other
 * would find its store missing. Keeping creation in one place removes that whole
 * class of ordering bug.
 *
 * Versions:
 *  - 1: `history`, which held rendered scrollback lines.
 *  - 2: added `commands`, dropped `history`.
 *  - 3: added `settings`, for the guest name and the chosen theme.
 */
@Injectable({ providedIn: 'root' })
export class TerminalDatabase {
  static readonly DB_NAME = 'mpdev-terminal';
  static readonly DB_VERSION = 3;
  static readonly COMMANDS = 'commands';
  static readonly SETTINGS = 'settings';

  private database?: Promise<IDBDatabase | null>;

  /** Resolves to null when IndexedDB is unavailable, so callers degrade quietly. */
  get(): Promise<IDBDatabase | null> {
    this.database ??= new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        // jsdom in unit tests, and some hardened browser configurations.
        resolve(null);
        return;
      }
      const request = indexedDB.open(TerminalDatabase.DB_NAME, TerminalDatabase.DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TerminalDatabase.COMMANDS)) {
          db.createObjectStore(TerminalDatabase.COMMANDS, { keyPath: 'seq', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(TerminalDatabase.SETTINGS)) {
          db.createObjectStore(TerminalDatabase.SETTINGS, { keyPath: 'key' });
        }
        if (db.objectStoreNames.contains('history')) {
          db.deleteObjectStore('history');
        }
      };
      request.onsuccess = () => resolve(request.result);
      /*
        Resolve rather than wait. A blocked upgrade means another tab still holds
        an older version open, and `onsuccess` may never fire at all. Dropping
        persistence for one session is survivable; a boot that never completes
        leaves the terminal stuck announcing itself as still loading.
      */
      request.onblocked = () => {
        console.warn(
          '[terminal] IndexedDB upgrade blocked by another tab, continuing without persistence',
        );
        resolve(null);
      };
      request.onerror = () => {
        console.warn('[terminal] IndexedDB unavailable, nothing will persist', request.error);
        resolve(null);
      };
    });
    return this.database;
  }
}
