import { Injectable, inject } from '@angular/core';
import { TerminalDatabase } from './terminal.database';

interface SettingsRow<T = unknown> {
  readonly key: string;
  readonly value: T;
}

/**
 * Small key/value persistence for the few things that must outlive a reload:
 * the chosen theme and this visitor's guest name.
 *
 * Shares its database with the command history (see TerminalDatabase), so the
 * app has one storage technology and one failure mode rather than IndexedDB for
 * some settings and localStorage for others.
 *
 * Reads are asynchronous, which localStorage is not. That means the first frame
 * paints before these values arrive, so callers must render a sensible default
 * and update in place.
 *
 * Like the rest of the persistence layer, every failure degrades to "did not
 * store" rather than throwing: a blocked upgrade or unavailable IndexedDB must
 * not stop the terminal being used.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  static readonly THEME = 'theme';
  static readonly GUEST_NAME = 'guestName';

  private readonly db = inject(TerminalDatabase);

  async load<T>(key: string): Promise<T | undefined> {
    const database = await this.db.get();
    if (!database) return undefined;

    return new Promise((resolve) => {
      try {
        const tx = database.transaction(TerminalDatabase.SETTINGS, 'readonly');
        const request = tx.objectStore(TerminalDatabase.SETTINGS).get(key);
        request.onsuccess = () => resolve((request.result as SettingsRow<T> | undefined)?.value);
        // Resolve rather than reject: a missing value is normal, a failed read is
        // not worth crashing the prompt over.
        request.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async save<T>(key: string, value: T): Promise<void> {
    const database = await this.db.get();
    if (!database) return;

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(TerminalDatabase.SETTINGS, 'readwrite');
        tx.objectStore(TerminalDatabase.SETTINGS).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (error) {
      console.warn('[terminal] setting could not be persisted', key, error);
    }
  }

  /**
   * This visitor's display name, generated once and then reused.
   *
   * It is stored rather than regenerated per load because command history is
   * persisted too: a new name on every reload would hand each fresh `guest-xxxx`
   * the previous visitor's history, which reads like an app that cannot keep
   * track of who it is talking to.
   *
   * There is no auth yet, so this is the only path; when a real login exists,
   * that name should win and this becomes the fallback. `Math.random` is fine
   * because the value is a label, not a credential.
   */
  async guestName(): Promise<string> {
    const existing = await this.load<string>(SettingsStore.GUEST_NAME);
    if (existing) return existing;

    const generated = `guest-${Math.random().toString(36).slice(2, 6)}`;
    await this.save(SettingsStore.GUEST_NAME, generated);
    return generated;
  }
}
