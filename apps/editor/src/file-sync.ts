export type DocumentKind = "scenario";

interface PickerWindow extends Window {
  showOpenFilePicker?: (options: { multiple: boolean; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle[]>;
}

function handleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kingmaker-editor", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storedHandle(kind: DocumentKind): Promise<FileSystemFileHandle | undefined> {
  const db = await handleDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("handles", "readonly").objectStore("handles").get(kind);
    request.onsuccess = () => { db.close(); resolve(request.result as FileSystemFileHandle | undefined); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function storeHandle(kind: DocumentKind, handle: FileSystemFileHandle): Promise<void> {
  const db = await handleDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("handles", "readwrite");
    transaction.objectStore("handles").put(handle, kind);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export class DiskDocument<T extends object> extends EventTarget {
  readonly kind: DocumentKind;
  handle?: FileSystemFileHandle;
  value?: T;
  dirty = false;
  conflict = false;
  lastModified = 0;
  private diskText = "";
  private revision = 0;
  private saving: Promise<void> | undefined;
  status = "Not connected";

  constructor(kind: DocumentKind) { super(); this.kind = kind; }

  get supported(): boolean { return Boolean((window as PickerWindow).showOpenFilePicker); }

  async restore(): Promise<boolean> {
    const handle = await storedHandle(this.kind).catch(() => undefined);
    const permissionHandle = handle as (FileSystemFileHandle & { queryPermission(options: { mode: "readwrite" }): Promise<PermissionState> }) | undefined;
    if (!permissionHandle || await permissionHandle.queryPermission({ mode: "readwrite" }) !== "granted") return false;
    this.handle = permissionHandle;
    await this.reload();
    return true;
  }

  async open(): Promise<void> {
    await this.save();
    if (this.dirty) throw new Error("Resolve unsaved changes before opening another file.");
    const picker = (window as PickerWindow).showOpenFilePicker;
    if (!picker) throw new Error("Use Chrome or Edge to edit local files.");
    const [handle] = await picker({ multiple: false, types: [{ description: `${this.kind} JSON`, accept: { "application/json": [".json"] } }] });
    if (!handle) return;
    this.handle = handle;
    await storeHandle(this.kind, handle);
    await this.reload();
  }

  change(update: (value: T) => void): void {
    if (!this.value) return;
    update(this.value);
    this.dirty = true;
    this.revision += 1;
    this.status = this.conflict ? "Disk changed while this editor has unsaved changes" : "Unsaved changes";
    this.dispatchEvent(new Event("dirty"));
  }

  replace(value: T): void {
    this.value = value;
    this.dirty = true;
    this.revision += 1;
    this.status = this.conflict ? "Disk changed while this editor has unsaved changes" : "Unsaved changes";
    this.dispatchEvent(new Event("change"));
  }

  async reload(): Promise<void> {
    if (!this.handle) return;
    const file = await this.handle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text) as T;
    this.diskText = text;
    this.value = parsed;
    this.lastModified = file.lastModified;
    this.dirty = false;
    this.conflict = false;
    this.status = `Loaded ${file.name}`;
    this.dispatchEvent(new Event("change"));
  }

  async checkDisk(): Promise<void> {
    if (!this.handle || this.saving) return;
    const file = await this.handle.getFile();
    const text = await file.text();
    if (text === this.diskText) return;
    if (this.dirty) {
      this.conflict = true;
      this.status = "Disk changed while this editor has unsaved changes";
      this.dispatchEvent(new Event("dirty"));
      return;
    }
    this.value = JSON.parse(text) as T;
    this.diskText = text;
    this.lastModified = file.lastModified;
    this.conflict = false;
    this.status = `Reloaded ${file.name} from disk`;
    this.dispatchEvent(new Event("change"));
  }

  async save(): Promise<void> {
    if (this.saving) { await this.saving; return this.save(); }
    const pending = this.write();
    this.saving = pending;
    try { await pending; } finally { this.saving = undefined; }
  }

  private async write(): Promise<void> {
    if (!this.handle || !this.value || !this.dirty || this.conflict) return;
    // Recheck immediately before writing, even if the polling interval has not elapsed.
    const before = await this.handle.getFile();
    if (await before.text() !== this.diskText) {
      this.conflict = true;
      this.status = "Disk changed while this editor has unsaved changes";
      this.dispatchEvent(new Event("dirty"));
      return;
    }
    const revision = this.revision;
    const text = `${JSON.stringify(this.value, null, 2)}\n`;
    const writable = await this.handle.createWritable();
    await writable.write(text);
    await writable.close();
    this.diskText = text;
    this.lastModified = (await this.handle.getFile()).lastModified;
    this.dirty = this.revision !== revision;
    this.status = this.dirty ? "Unsaved changes" : `Saved ${this.handle.name}`;
    // Saving should not replace the focused input or interrupt the next click.
    this.dispatchEvent(new Event("dirty"));
  }
}
