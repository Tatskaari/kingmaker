interface WaitJob { key: string; started: number; controller: AbortController; timer?: ReturnType<typeof setTimeout> }
export interface WaitSchedulerOptions {
  candidates(): ReadonlyMap<string, string>;
  busy(id: string): boolean;
  run(id: string, elapsedSeconds: number, signal: AbortSignal): Promise<void>;
  error(id: string, error: unknown): void;
  now?: () => number;
  random?: () => number;
  delayMs?: (id: string) => number;
}
/** Per-character timers; no overlapping decisions and no catch-up bursts after a suspended tab. */
export class WaitScheduler {
  private jobs = new Map<string, WaitJob>();
  constructor(private options: WaitSchedulerOptions) {}
  private now() { return (this.options.now ?? (() => performance.now()))(); }
  private delay(id: string) { return this.options.delayMs?.(id) ?? 12_000 + (this.options.random ?? Math.random)() * 6_000; }
  cancel(id: string) {
    const job = this.jobs.get(id);
    if (job) { clearTimeout(job.timer); job.controller.abort(); this.jobs.delete(id); }
  }
  stop() { for (const id of this.jobs.keys()) this.cancel(id); }
  sync() {
    const candidates = this.options.candidates();
    for (const [id, job] of this.jobs) if (candidates.get(id) !== job.key) this.cancel(id);
    for (const [id, key] of candidates) {
      if (this.jobs.has(id)) continue;
      const job: WaitJob = { key, started: this.now(), controller: new AbortController() };
      this.jobs.set(id, job); this.schedule(id, job);
    }
  }
  private schedule(id: string, job: WaitJob) {
    job.timer = setTimeout(() => { void this.tick(id, job); }, this.delay(id));
    // Headless worker tests must not be kept alive by browser timers.
    if (typeof job.timer === "object") job.timer.unref?.();
  }
  private async tick(id: string, job: WaitJob) {
    if (this.jobs.get(id) !== job) return;
    try {
      if (this.options.candidates().get(id) !== job.key) { this.cancel(id); return; }
      if (!this.options.busy(id)) await this.options.run(id, Math.max(0, this.now() - job.started) / 1000, job.controller.signal);
    } catch (error) {
      if (!job.controller.signal.aborted) this.options.error(id, error);
    } finally {
      if (this.jobs.get(id) === job && !job.controller.signal.aborted) {
        this.schedule(id, job);
        this.sync();
      }
    }
  }
}
