export class AlertLog {
  readonly entries: Array<{ level: "warning" | "error"; message: string; time: number; unread: boolean }> = [];
  add(level: "warning" | "error", message: string) {
    this.entries.unshift({ level, message, time: Date.now(), unread: true });
    this.entries.splice(50);
  }
  acknowledge() { for (const entry of this.entries) entry.unread = false; }
  clear() { this.entries.length = 0; }
  get unread() { return this.entries.filter(entry => entry.unread).length; }
  get severity() {
    const unread = this.entries.filter(entry => entry.unread);
    return unread.some(entry => entry.level === "error") ? "error" : unread.length ? "warning" : "";
  }
}
