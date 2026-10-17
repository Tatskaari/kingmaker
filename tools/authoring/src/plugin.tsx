import React from 'react';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {FuzzySuggestModal, Modal, normalizePath, Notice, Plugin, Setting, TextFileView, TFile, TFolder} from 'obsidian';
import type {App as ObsidianApp, WorkspaceLeaf} from 'obsidian';
import {App} from './App';
import {emptyDocument, parseDocument, serializeDocument} from './model';
import type {ContentFile, FileEntry, GraphDocument, Host, Lore} from './model';

const VIEW = 'kingmaker-authoring-file';
const EXTENSIONS = ['kmscene', 'kmscenario', 'kmmap'];
type DocumentKind = 'scene'|'scenario'|'map';
const extensionFor = (kind: DocumentKind) => ({scene:'kmscene', scenario:'kmscenario', map:'kmmap'}[kind]);
const kindFor = (file: TFile): DocumentKind => file.extension.toLowerCase() === 'kmscenario' ? 'scenario' : file.extension.toLowerCase() === 'kmmap' ? 'map' : 'scene';
const isDocument = (file: TFile) => EXTENSIONS.includes(file.extension.toLowerCase());
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The file, not plugin data or a browser cache, is the editor's source of truth. */
export class KingmakerFileView extends TextFileView {
  private root: Root|null = null;
  private raw = '';
  private document: GraphDocument|null = null;
  private revision = 0;
  private parseError: string|null = null;
  private diskRaw = '';
  private saving: Promise<void> = Promise.resolve();
  private activeSave: {file:TFile;raw:string;expected:string}|null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: WorkshopPlugin) {
    super(leaf);
    this.contentEl.style.padding = '0';
    this.contentEl.style.overflow = 'hidden';
    this.plugin.attachView(this);
  }

  getViewType() { return VIEW; }
  getIcon() { return 'git-branch'; }
  canAcceptExtension(extension: string) { return EXTENSIONS.includes(extension.toLowerCase()); }

  getViewData() { return this.raw; }

  readDocument(): GraphDocument {
    if (!this.document || this.parseError) throw new Error(`Cannot read ${this.file?.path ?? 'this file'}: ${this.parseError ?? 'file is not open'}`);
    return parseDocument(serializeDocument(this.document), this.document.kind);
  }

  getDiskData() { return this.diskRaw; }

  applyExternalDocument(document: GraphDocument, notify = true) {
    this.document = parseDocument(serializeDocument(document), this.file ? kindFor(this.file) : document.kind);
    this.raw = serializeDocument(this.document);
    this.parseError = null;
    this.revision += 1;
    this.renderEditor();
    this.requestSave();
    if (notify) this.plugin.documentsChanged();
  }

  setViewData(data: string, clear: boolean) {
    // A write can echo after the user has already typed a newer draft. Known
    // saved bytes acknowledge the write; they do not replace that newer draft.
    if (!clear && this.document) {
      if (data === this.raw || data === this.diskRaw) {
        this.diskRaw = data;
        this.data = data;
        return;
      }
      const pending = this.activeSave;
      if (pending?.file === this.file && data === pending.raw) {
        if (this.diskRaw === pending.expected || this.diskRaw === pending.raw) {
          this.diskRaw = data;
          this.data = data;
        }
        return;
      }
    }
    this.diskRaw = data;
    this.data = data;
    this.raw = data;
    this.revision += 1;
    try {
      const kind = this.file ? kindFor(this.file) : 'scene';
      this.document = parseDocument(data, kind);
      this.parseError = null;
    } catch (error) {
      // Retain the exact bytes so closing an invalid file cannot replace it.
      this.document = null;
      this.parseError = message(error);
    }
    this.renderEditor();
    this.plugin.documentsChanged();
  }

  /** A delayed autosave must not overwrite an external edit that arrived meanwhile. */
  async save(clear = false) {
    const pending = this.saving.then(async () => {
      const file = this.file;
      const raw = this.raw;
      const expected = this.diskRaw;
      const revision = this.revision;
      if (file && raw !== expected) {
        const active = {file,raw,expected};
        this.activeSave = active;
        try { await this.app.vault.process(file, disk => {
          // Both the baseline and this document's identity belong to this save.
          // An external reload must not make an older queued draft look current.
          if (this.file !== file || this.revision !== revision) throw new Error(`Save conflict: ${file.path} changed or reloaded while saving. The current editor content has been kept.`);
          if (disk !== expected && disk !== raw) throw new Error(`Save conflict: ${file.path} changed outside this editor. Your draft has been kept.`);
          return raw;
        }); } finally { if (this.activeSave === active) this.activeSave = null; }
        // A later reload may complete after the atomic write but before its
        // promise settles. Never replace that new baseline or clear its view.
        if (this.file === file && this.revision === revision && (this.diskRaw === expected || this.diskRaw === raw)) {
          this.diskRaw = raw;
          this.data = raw;
        }
      }
      if (clear && this.file === file && this.revision === revision && this.raw === raw) this.clear();
    });
    this.saving = pending.catch(() => {});
    await pending;
  }

  clear() {
    this.raw = '';
    this.document = null;
    this.parseError = null;
    this.revision += 1;
    this.renderEditor();
    this.plugin.documentsChanged();
  }

  async onOpen() { this.renderEditor(); }

  async onRename(file: TFile) {
    this.revision += 1;
    await super.onRename(file);
    this.renderEditor();
    this.plugin.documentsChanged();
  }

  async onUnloadFile(file: TFile) {
    // A modal or other async action from this editor can finish after navigation.
    // Invalidate its callbacks before TextFileView takes the final save snapshot.
    this.revision += 1;
    try {
      await super.onUnloadFile(file);
    } catch (error) {
      this.renderEditor();
      throw error;
    }
  }

  async onClose() {
    // TextFileView.onUnloadFile flushes getViewData before this teardown.
    this.revision += 1;
    this.root?.unmount();
    this.root = null;
    this.plugin.detachView(this);
  }

  private renderEditor() {
    this.root ??= createRoot(this.contentEl);
    if (!this.document) {
      this.root.render(this.parseError ? <div className="km-file-error" style={{padding:24}}>
        <h3>Cannot open this Kingmaker file</h3>
        <p>{this.parseError}</p>
        <p>The file has been left unchanged. Fix its JSON in a text editor and reopen it.</p>
      </div> : null);
      return;
    }
    const revision = this.revision;
    const assertActive = () => {
      if (revision !== this.revision || !this.file || this.parseError) throw new Error('This editor has changed or closed. Reopen it and try again.');
    };
    const read = async <T,>(action: () => Promise<T>): Promise<T> => {
      assertActive();
      const value = await action();
      assertActive();
      return value;
    };
    const createLinked = async (kind: 'scene'|'map') => {
      assertActive();
      const preferred = this.app.vault.getAbstractFileByPath(kind === 'scene' ? 'Scenes' : 'Maps');
      const parent = preferred instanceof TFolder ? preferred : this.file?.parent ?? this.app.vault.getRoot();
      const file = await this.plugin.createDocument(kind, parent, false, assertActive);
      assertActive();
      return file ? {path:file.path, title:file.basename} : null;
    };
    const host: Host = {
      filePath: this.file?.path ?? '',
      change: document => {
        if (revision !== this.revision || !this.file || this.parseError) return;
        const raw = serializeDocument(document);
        if (raw === this.raw) return;
        this.document = document;
        // Update immediately; closing the tab before the debounce still saves.
        this.raw = raw;
        this.requestSave();
        this.plugin.documentsChanged();
      },
      lore: () => this.plugin.readLore(),
      openFile: path => this.plugin.openVaultFile(path, this.file?.path),
      listScenes: () => this.plugin.listScenes(),
      createScene: () => createLinked('scene'),
      createMap: () => createLinked('map'),
      listDocuments: () => read(() => this.plugin.listDocuments()),
      readDocument: path => read(() => this.plugin.readDocument(path)),
      writeDocument: async (path, before, after) => {
        assertActive();
        await this.plugin.writeDocument(path, before, after, assertActive);
        assertActive();
      },
      subscribeDocuments: listener => {
        assertActive();
        return this.plugin.subscribeDocuments(() => {
          if (revision === this.revision && this.file && !this.parseError) listener();
        });
      },
    };
    this.root.render(<App key={this.revision} document={this.document} host={host}/>);
  }
}

class NameDocumentModal extends Modal {
  private resolve: (name: string|null) => void;
  private submitted = false;
  constructor(app: ObsidianApp, private kind: DocumentKind, private folder: TFolder, resolve: (name: string|null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    this.setTitle(`New Kingmaker ${this.kind}`);
    this.contentEl.createEl('p', {text:`Create a .${extensionFor(this.kind)} file in ${this.folder.path || 'the vault root'}.`});
    let name = '';
    let input: HTMLInputElement;
    const error = this.contentEl.createEl('p', {cls:'mod-warning'});
    const submit = () => {
      const cleaned = name.trim().replace(/\.(kmscene|kmscenario|kmmap)$/i, '').trim();
      if (!cleaned || cleaned === '.' || cleaned === '..' || /[\\/:*?"<>|\x00-\x1F]/.test(cleaned)) {
        error.setText('Choose a filename without slashes or special filename characters.');
        return;
      }
      const path = normalizePath(`${this.folder.path}/${cleaned}.${extensionFor(this.kind)}`);
      if (this.app.vault.getAbstractFileByPath(path)) {
        error.setText('A file with that name already exists. Choose another name.');
        return;
      }
      this.submitted = true;
      this.resolve(cleaned);
      this.close();
    };
    new Setting(this.contentEl).setName('Name').addText(text => {
      input = text.inputEl;
      text.setPlaceholder(this.kind === 'scene' ? 'The Hanged Clerk' : this.kind === 'map' ? 'Granary Yard' : 'Caerwyn');
      text.onChange(value => { name = value; error.empty(); });
      text.inputEl.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
      });
    });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Create').setCta().onClick(submit));
    input!.focus();
  }

  onClose() {
    if (!this.submitted) this.resolve(null);
    this.contentEl.empty();
  }
}

class OpenDocumentModal extends FuzzySuggestModal<TFile> {
  constructor(app: ObsidianApp, private files: TFile[]) {
    super(app);
    this.setPlaceholder('Open a Kingmaker scene, map or scenario…');
  }
  getItems() { return this.files; }
  getItemText(file: TFile) { return file.path; }
  onChooseItem(file: TFile) { void this.app.workspace.getLeaf('tab').openFile(file); }
}

export default class WorkshopPlugin extends Plugin {
  private fileViews = new Set<KingmakerFileView>();
  private documentListeners = new Set<() => void>();

  attachView(view: KingmakerFileView) { this.fileViews.add(view); }
  detachView(view: KingmakerFileView) { this.fileViews.delete(view); this.documentsChanged(); }
  documentsChanged() { for (const listener of this.documentListeners) listener(); }
  subscribeDocuments(listener: () => void) {
    this.documentListeners.add(listener);
    return () => { this.documentListeners.delete(listener); };
  }

  async onload() {
    this.registerView(VIEW, leaf => new KingmakerFileView(leaf, this));
    this.registerExtensions(EXTENSIONS, VIEW);
    this.registerEvent(this.app.vault.on('modify', () => this.documentsChanged()));
    this.registerEvent(this.app.vault.on('create', () => this.documentsChanged()));
    this.registerEvent(this.app.vault.on('delete', () => this.documentsChanged()));
    this.registerEvent(this.app.vault.on('rename', () => this.documentsChanged()));

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      const parent = file instanceof TFolder ? file : file.parent;
      if (!parent) return;
      for (const kind of ['scene','scenario','map'] as const) {
        menu.addItem(item => item.setTitle(`New Kingmaker ${kind}`).setIcon(kind === 'scene' ? 'git-branch' : 'map')
          .onClick(() => { void this.createDocument(kind, parent); }));
      }
    }));
    for (const kind of ['scene','scenario','map'] as const) {
      this.addCommand({
        id:`new-${kind}`, name:`Create new ${kind}`,
        callback:() => {
          const preferred = this.app.vault.getAbstractFileByPath(kind === 'scene' ? 'Scenes' : kind === 'map' ? 'Maps' : 'Scenarios');
          const parent = preferred instanceof TFolder ? preferred : this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot();
          void this.createDocument(kind, parent);
        },
      });
    }
    const open = () => {
      const files = this.app.vault.getFiles().filter(isDocument).sort((a,b) => a.path.localeCompare(b.path));
      if (!files.length) { new Notice('No Kingmaker files yet. Right-click a folder to create a scene, map or scenario.'); return; }
      new OpenDocumentModal(this.app, files).open();
    };
    this.addRibbonIcon('git-branch', 'Open Kingmaker scene, map or scenario', open);
    this.addCommand({id:'open-file', name:'Open scene, map or scenario', callback:open});
  }

  async createDocument(kind: DocumentKind, parent: TFolder, open = true, assertActive: () => void = () => {}): Promise<TFile|null> {
    assertActive();
    const name = await new Promise<string|null>(resolve => new NameDocumentModal(this.app, kind, parent, resolve).open());
    assertActive();
    if (!name) return null;
    let file: TFile;
    try {
      const path = normalizePath(`${parent.path}/${name}.${extensionFor(kind)}`);
      file = await this.app.vault.create(path, serializeDocument(emptyDocument(kind, name)));
    } catch (error) {
      new Notice(`Could not create ${kind}: ${message(error)}`);
      return null;
    }
    this.documentsChanged();
    if (open) {
      try {
        await this.app.workspace.getLeaf('tab').openFile(file);
      } catch (error) {
        new Notice(`Created ${file.path}, but could not open it: ${message(error)}`);
      }
    }
    return file;
  }

  private contentFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile) || !isDocument(file)) throw new Error(`Kingmaker file not found: ${path}`);
    return file;
  }

  private openDocuments(file: TFile): {view: KingmakerFileView; document: GraphDocument}[] {
    const open = [...this.fileViews].filter(view => view.file?.path === file.path).map(view => ({view, document:view.readDocument()}));
    if (open.some(item => serializeDocument(item.document) !== serializeDocument(open[0].document))) {
      throw new Error(`Conflicting open editors for ${file.path}. Save or close them before editing its ports here.`);
    }
    return open;
  }

  async readDocument(path: string): Promise<GraphDocument> {
    const file = this.contentFile(path);
    const open = this.openDocuments(file);
    if (open.length) return open[0].document;
    const raw = await this.app.vault.read(file);
    // An editor may have opened and changed the file while the read was pending.
    const latest = this.openDocuments(file);
    return latest.length ? latest[0].document : parseDocument(raw, kindFor(file));
  }

  async listDocuments(): Promise<ContentFile[]> {
    const files = this.app.vault.getFiles().filter(isDocument).sort((a,b) => a.path.localeCompare(b.path));
    return Promise.all(files.map(async file => {
      try { return {path:file.path, document:await this.readDocument(file.path)}; }
      catch (error) { return {path:file.path, error:message(error)}; }
    }));
  }

  async writeDocument(path: string, before: GraphDocument, after: GraphDocument, assertActive: () => void = () => {}) {
    assertActive();
    const file = this.contentFile(path);
    const kind = kindFor(file);
    if (kind === 'scenario') throw new Error('Port edits may update scene or map files only.');
    const expected = serializeDocument(parseDocument(serializeDocument(before), kind));
    const nextDocument = parseDocument(serializeDocument(after), kind);
    const next = serializeDocument(nextDocument);
    if (nextDocument.id !== before.id) throw new Error('A port edit cannot change the source document identity.');
    const checkOpen = () => {
      const open = this.openDocuments(file);
      if (open.some(item => serializeDocument(item.document) !== expected)) throw new Error(`Edit conflict: ${path} changed. Refresh the overview and try again.`);
      return open;
    };
    let open = checkOpen();
    if (open.length) {
      const disk = await this.app.vault.read(file);
      assertActive();
      open = checkOpen();
      if (open.length) {
        if (open.some(item => disk !== item.view.getDiskData() && disk !== item.view.getViewData())) {
          throw new Error(`Edit conflict: ${path} changed outside its open editor. Reload it before editing its ports.`);
        }
        for (const item of open) item.view.applyExternalDocument(nextDocument, false);
        this.documentsChanged();
        return;
      }
    }
    // Vault.process holds the file operation atomically, including the comparison.
    await this.app.vault.process(file, raw => {
      assertActive();
      if (this.openDocuments(file).length) throw new Error(`An editor opened ${path} during this edit. Refresh and try again.`);
      if (serializeDocument(parseDocument(raw, kind)) !== expected) throw new Error(`Edit conflict: ${path} changed. Refresh the overview and try again.`);
      return next;
    });
    this.documentsChanged();
  }

  async openVaultFile(path: string, sourcePath = '') {
    // Store exact vault-relative paths. The cache also resolves ordinary wiki links.
    const direct = this.app.vault.getAbstractFileByPath(normalizePath(path));
    const file = direct instanceof TFile ? direct : this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (!file) {
      new Notice(`Linked file not found: ${path}`);
      throw new Error(`Linked file not found: ${path}`);
    }
    await this.app.workspace.getLeaf('tab').openFile(file);
  }

  async listScenes(): Promise<FileEntry[]> {
    const files = this.app.vault.getFiles().filter(file => file.extension.toLowerCase() === 'kmscene');
    return Promise.all(files.sort((a,b) => a.path.localeCompare(b.path)).map(async file => {
      try {
        const document = await this.readDocument(file.path);
        return {path:file.path, title:document.title};
      } catch {
        return {path:file.path, title:`${file.basename} (invalid file)`};
      }
    }));
  }

  async readLore(): Promise<Lore[]> {
    const files = this.app.vault.getMarkdownFiles();
    // A Cast entry normally has public/private/gm/index notes. Offer its public
    // card once, while still supporting flat character notes and other folders.
    const publicFolders = new Set(files.filter(file => /(^|\/)Cast\//i.test(file.path) && file.basename.toLowerCase() === 'public').map(file => file.parent?.path));
    const selected = files.filter(file => {
      if (!/(^|\/)Cast\//i.test(file.path)) return true;
      if (publicFolders.has(file.parent?.path)) return file.basename.toLowerCase() === 'public';
      return file.path.toLowerCase() !== 'cast/index.md' && !['private','gm'].includes(file.basename.toLowerCase()) && !/(^|\/)knowledge\//i.test(file.path);
    });
    return Promise.all(selected.sort((a,b) => a.path.localeCompare(b.path)).map(async file => {
      const meta = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const requestedKind = typeof meta?.kind === 'string' ? meta.kind.toLowerCase() : '';
      const kind: Lore['kind'] = requestedKind === 'object' || /(^|\/)Objects\//i.test(file.path) ? 'object'
        : requestedKind === 'place' || /(^|\/)Places\//i.test(file.path) ? 'place'
        : requestedKind === 'character' || /(^|\/)Cast\//i.test(file.path) ? 'character' : 'note';
      const name = typeof meta?.name === 'string' ? meta.name
        : ['public','index'].includes(file.basename.toLowerCase()) ? file.parent?.name ?? file.basename : file.basename;
      return {id:file.path, name, kind, path:file.path, text:await this.app.vault.cachedRead(file)};
    }));
  }
}
