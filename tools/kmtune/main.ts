import { Plugin, TextFileView, Notice, Scope, normalizePath, type TFile, type WorkspaceLeaf } from 'obsidian';
import { newTune, parseTune, writeTune } from '../../client/sound/tune.ts';
import { TuneEditor } from './editor.ts';
const VIEW = 'kingmaker-tune';
export default class TunePlugin extends Plugin {
  onload(): void {
    this.registerView(VIEW, leaf => new TuneView(leaf, this));
    this.registerExtensions(['kmtune'], VIEW);
    this.addCommand({ id: 'new-tune', name: 'Create tune', callback: async () => {
      try {
        let name = 'New tune.kmtune', i = 1;
        while (this.app.vault.getAbstractFileByPath(name)) name = `New tune ${i++}.kmtune`;
        const file = await this.app.vault.create(name, writeTune(newTune()));
        await this.app.workspace.getLeaf(true).openFile(file);
      } catch (e) { new Notice(String(e)); }
    } });
  }
  onunload(): void { this.app.workspace.getLeavesOfType(VIEW).forEach(leaf => leaf.detach()); }
}
class TuneView extends TextFileView {
  private editor?: TuneEditor;
  private raw = '';
  private diskRaw = '';
  private revision = 0;
  private saving: Promise<void> = Promise.resolve();
  private activeSave: { file: TFile; raw: string; expected: string } | null = null;
  private readonly plugin: TunePlugin;
  constructor(leaf: WorkspaceLeaf, plugin: TunePlugin) {
    super(leaf); this.plugin = plugin;
    this.scope = new Scope(this.app.scope);
    for (const [modifiers, key] of [[['Mod'], 'z'], [['Mod', 'Shift'], 'z'], [['Mod'], 'y']] as const) {
      this.scope.register([...modifiers], key, event => {
        if (event.defaultPrevented || this.editor?.handleHistoryKey(event)) return false;
      });
    }
  }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return this.file?.basename ?? 'Tune'; }
  getViewData(): string { return this.raw; }
  setViewData(data: string, clear: boolean): void {
    // A delayed write can echo after another edit. Acknowledge our saved bytes
    // without replacing the newer draft or discarding its undo history.
    if (!clear && this.editor) {
      if (data === this.raw || data === this.diskRaw) { this.diskRaw = data; this.data = data; return; }
      const pending = this.activeSave;
      if (pending?.file === this.file && data === pending.raw) {
        if (this.diskRaw === pending.expected || this.diskRaw === pending.raw) { this.diskRaw = data; this.data = data; }
        return;
      }
    }
    this.editor?.destroy(); this.editor = undefined;
    this.diskRaw = data; this.data = data; this.raw = data; this.revision += 1; this.contentEl.replaceChildren();
    try {
      const tune = parseTune(data);
      const dir = this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
      const url = this.app.vault.adapter.getResourcePath(normalizePath(`${dir}/sound-worklet.js`));
      const revision = this.revision;
      this.editor = new TuneEditor(this.contentEl, tune, url, next => {
        if (this.revision !== revision) return;
        this.raw = writeTune(next); this.requestSave();
      });
    } catch (e) {
      const error = document.createElement('p'); error.textContent = `${e}. The original file has been preserved. Repair its JSON in a text editor and reopen it.`; this.contentEl.append(error);
    }
  }
  async save(clear = false): Promise<void> {
    const pending = this.saving.then(async () => {
      const file = this.file, raw = this.raw, expected = this.diskRaw, revision = this.revision;
      if (file && raw !== expected) {
        const active = { file, raw, expected }; this.activeSave = active;
        try {
          await this.app.vault.process(file, disk => {
            if (this.file !== file || this.revision !== revision) throw new Error(`Save conflict: ${file.path} changed or reloaded while saving. The current tune has been kept.`);
            if (disk !== expected && disk !== raw) throw new Error(`Save conflict: ${file.path} changed outside this editor. Your tune has been kept.`);
            return raw;
          });
        } finally { if (this.activeSave === active) this.activeSave = null; }
        if (this.file === file && this.revision === revision && (this.diskRaw === expected || this.diskRaw === raw)) {
          this.diskRaw = raw; this.data = raw;
        }
      }
      if (clear && this.file === file && this.revision === revision && this.raw === raw) this.clear();
    });
    this.saving = pending.catch(() => {});
    await pending;
  }
  clear(): void {
    this.editor?.destroy(); this.editor = undefined; this.raw = ''; this.diskRaw = ''; this.data = ''; this.revision += 1; this.contentEl.replaceChildren();
  }
  async onClose(): Promise<void> { this.editor?.destroy(); await super.onClose(); }
}
