import { Injectable, inject } from '@angular/core';
import { TerminalDatabase } from './terminal.database';

/** One remembered command. `seq` is filled in by IndexedDB's autoIncrement. */
export interface StoredCommand {
  readonly text: string;
  readonly at: number;
  readonly seq?: number;
}

/**
 * The command history: what `history` lists and what `up` will recall.
 *
 * Independent of what is on screen, which is the whole point - `clear` erases the
 * display and must not touch any of this, the way a real shell keeps history in a
 * file rather than in the terminal's scrollback.
 */
@Injectable({ providedIn: 'root' })
export class CommandStore {
  /** Ceiling on the log, roughly bash's HISTFILESIZE, so it cannot grow forever. */
  private static readonly MAX_COMMANDS = 2000;

  private readonly db = inject(TerminalDatabase);

  /** Every remembered command, oldest first. Empty when persistence is unavailable. */
  async load(limit: number = CommandStore.MAX_COMMANDS): Promise<StoredCommand[]> {
    const database = await this.db.get();
    if (!database) return [];

    return new Promise((resolve) => {
      const rows: StoredCommand[] = [];
      const tx = database.transaction(TerminalDatabase.COMMANDS, 'readonly');
      // One settle path: whatever stops the walk, the transaction still completes.
      tx.oncomplete = () => resolve(rows.reverse());
      tx.onerror = () => resolve(rows.reverse());
      tx.onabort = () => resolve(rows.reverse());

      // Walking from the newest key keeps the read bounded by `limit` instead of
      // pulling the whole log only to slice the tail off it.
      const cursorRequest = tx.objectStore(TerminalDatabase.COMMANDS).openCursor(null, 'prev');
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || rows.length >= limit) return;
        rows.push(cursor.value);
        cursor.continue();
      };
    });
  }

  async append(text: string): Promise<void> {
    const database = await this.db.get();
    if (!database) return;

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(TerminalDatabase.COMMANDS, 'readwrite');
        // seq is omitted so autoIncrement assigns it.
        tx.objectStore(TerminalDatabase.COMMANDS).add({ text, at: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      await this.trim();
    } catch (error) {
      console.warn('[terminal] command could not be persisted', error);
    }
  }

  /** Drop the oldest commands past MAX_COMMANDS, walking up from the lowest key. */
  private async trim(): Promise<void> {
    const database = await this.db.get();
    if (!database) return;

    await new Promise<void>((resolve) => {
      const tx = database.transaction(TerminalDatabase.COMMANDS, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();

      const store = tx.objectStore(TerminalDatabase.COMMANDS);
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
