import { Injectable, inject } from '@angular/core';
import { TerminalDatabase } from './terminal.database';

interface SettingsRow<T = unknown> {
  readonly key: string;
  readonly value: T;
}

/**
 * Small key/value persistence for the few things that must outlive a reload:
 * the chosen theme, the chosen font, and this visitor's guest name.
 *
 * Shares its database with the command history (see TerminalDatabase), so the
 * app has one storage technology and one failure mode rather than IndexedDB for
 * some settings and localStorage for others.
 *
 * Adding a setting costs a key, not a version: the store is a plain
 * `key` -> `value` table, so nothing migrates when a new one is introduced.
 *
 * Reads are asynchronous, which localStorage is not. That means the first frame
 * paints before these values arrive, so callers must render a sensible default
 * and update in place.
 *
 * Like the rest of the persistence layer, nothing here throws at the caller: a
 * blocked upgrade or unavailable IndexedDB degrades to "did not store", which is
 * reported by `save`'s result rather than as an exception, so a command can say
 * honestly whether the visitor's choice will still be there after a reload.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  static readonly THEME = 'theme';
  static readonly FONT = 'font';
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

  /**
   * Store one setting, reporting whether it actually landed.
   *
   * The boolean matters because callers cannot assume the browser let them write:
   * private mode, a full quota and a second tab holding an old database version
   * are all ordinary things that happen, and a `font --save` that claimed success
   * in the face of them would be a lie the visitor only finds out after a reload.
   */
  async save<T>(key: string, value: T): Promise<boolean> {
    const database = await this.db.get();
    if (!database) return false;

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(TerminalDatabase.SETTINGS, 'readwrite');
        tx.objectStore(TerminalDatabase.SETTINGS).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return true;
    } catch (error) {
      console.warn('[terminal] setting could not be persisted', key, error);
      return false;
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
