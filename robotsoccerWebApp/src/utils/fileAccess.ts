/*
 * Saving strategies straight back into the same file on the computer.
 *
 * Chrome and Edge support the File System Access API: once you've picked a file (by saving it the
 * first time, Save As, or opening it), the app keeps a handle to it and can write into that exact
 * file again — no new download each time. Other browsers fall back to a normal download.
 */

// The API isn't in TypeScript's standard DOM types everywhere yet, so describe the bits we use.
export interface StrategyFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
}

type PickerWindow = Window & {
  showSaveFilePicker?: (opts: unknown) => Promise<StrategyFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<StrategyFileHandle[]>;
};

const JSON_TYPES = [{ description: 'Robot soccer strategy', accept: { 'application/json': ['.json'] } }];

/** Can this browser save back into the same file? */
export const canSaveInPlace = (): boolean =>
  typeof window !== 'undefined' && typeof (window as PickerWindow).showSaveFilePicker === 'function';

/** True when the user just closed a file dialog without choosing (not an error worth showing). */
export const isCancel = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/** Ask where to save (a normal "Save as" dialog). Throws AbortError if cancelled. */
export const pickSaveFile = (suggestedName: string) =>
  (window as PickerWindow).showSaveFilePicker!({ suggestedName, types: JSON_TYPES });

/** Ask which strategy file to open; returns its handle and text. Throws AbortError if cancelled. */
export const pickOpenFile = async () => {
  const [handle] = await (window as PickerWindow).showOpenFilePicker!({ types: JSON_TYPES, multiple: false });
  const text = await (await handle.getFile()).text();
  return { handle, text };
};

/** Overwrite the file behind `handle` with `text` (asks for permission again if the browser needs). */
export const writeToFile = async (handle: StrategyFileHandle, text: string) => {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    const ok = await handle.requestPermission?.({ mode: 'readwrite' });
    if (ok !== 'granted') throw new DOMException('Permission to write the file was not given', 'NotAllowedError');
  }
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
};

/** Fallback for browsers without the API: download a copy. */
export const downloadFile = (filename: string, text: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
