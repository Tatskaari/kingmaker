interface AutosaveOptions {
  save(): Promise<void>;
  error(error: unknown): void;
  intervalMs?: number;
}

/** Dirty writes are coalesced on a periodic timer, outside the action queue. */
export class Autosave {
  private revision = 0;
  private savedRevision = 0;
  private timer?: ReturnType<typeof setTimeout> | undefined;
  private saving?: Promise<void> | undefined;
  constructor(private readonly options: AutosaveOptions) {}
  markDirty() { this.revision++; this.schedule(); }
  private schedule() {
    if (this.timer || this.saving || this.revision === this.savedRevision) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.saveOnce().catch(this.options.error);
    }, this.options.intervalMs ?? 5000);
    if (typeof this.timer === "object") this.timer.unref?.();
  }
  private saveOnce(): Promise<void> {
    if (this.saving) return this.saving;
    if (this.revision === this.savedRevision) return Promise.resolve();
    const revision = this.revision;
    this.saving = Promise.resolve().then(() => this.options.save()).then(() => {
      this.savedRevision = revision;
    }).finally(() => { this.saving = undefined; this.schedule(); });
    return this.saving;
  }
  /** Explicit saves and game switches wait; ordinary actions only mark dirty. */
  async flush() {
    clearTimeout(this.timer); this.timer = undefined;
    try {
      do { await this.saveOnce(); } while (this.revision !== this.savedRevision);
    } finally {
      clearTimeout(this.timer); this.timer = undefined; this.schedule();
    }
  }
}
