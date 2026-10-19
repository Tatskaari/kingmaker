import { INSTRUMENTS, INSTRUMENT_LABELS, SCALES, DRUM_LANES, drumKind, snapDrumPitch, mergeDrumTracks, inScale, snapPitch, isPercussion, noteParts, validateTune, canUpdateTune, type Tune, type TuneNote, type TuneSection, type TuneTrack, type TuneInstrument, type TunePatch } from '../../client/sound/tune.ts';

const clone = <T>(v: T): T => structuredClone(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const pitch = (m: number) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][m % 12]}${Math.floor(m / 12) - 1}`;
interface HistoryEntry { tune: Tune; section: number; track: number; selected: number; selection: number[]; arrangement: number; bottom: number; scrollTop: number; scrollLeft: number }
interface Box { x: number; y: number; width: number; height: number }
interface RollPreview { notes?: Map<number, TuneNote>; added?: TuneNote; box?: Box }
/** The editor is independent of Obsidian so the same interactions can be checked in a browser. */
export class TuneEditor {
  private section = 0; private track = 0; private primary = -1; private selection = new Set<number>(); private snap = 0.5; private bottom = 48;
  private tool: 'draw' | 'select' = 'draw'; private cancelGesture?: () => void;
  private undo: HistoryEntry[] = []; private redo: HistoryEntry[] = []; private clipboard?: TuneNote[];
  private audio?: AudioContext; private node?: AudioWorkletNode; private generation = 0; private frame = 0;
  private status = ''; private playing = false; private playButton?: HTMLButtonElement; private playhead?: HTMLElement;
  private undoButton?: HTMLButtonElement; private redoButton?: HTMLButtonElement;
  private canvas?: HTMLCanvasElement; private destroyed = false;
  private beatWidth = 72; private scrollTop = 180; private scrollLeft = 0;
  private themeObserver?: MutationObserver;
  private muted = new Set<number>(); private solo = -1;
  private arrangementEntry?: Tune['arrangement'][number];
  private addingTrack = false; private sectionPlayback = true;
  private previewFilter?: { section: string; muted: Set<number>; solo: number };
  private readonly onKey = (event: KeyboardEvent) => {
    if (this.handleHistoryKey(event)) return;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || target?.closest('input, textarea, select, [role="textbox"]')) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (this.cancelGesture) this.cancelGesture(); else { this.selected = -1; this.draw(); } return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selection.size) {
      event.preventDefault(); event.stopPropagation(); this.deleteNotes(); return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'a' || key === 'c' || key === 'v') {
        event.preventDefault(); event.stopPropagation();
        if (key === 'a') { this.selectNotes(this.current.tracks[this.track]?.notes.map((_, i) => i) ?? []); this.draw(); }
        else if (key === 'c') this.copyNotes(); else this.pasteNotes();
        return;
      }
    }
    if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    if (this.audio) this.stop(); else void this.play(this.sectionPlayback);
  };
  /** Also called by Obsidian's view scope, before its global editing shortcuts. */
  handleHistoryKey(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return false;
    const key = event.key.toLowerCase();
    if (key !== 'z' && (key !== 'y' || event.shiftKey)) return false;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || target?.closest('input, textarea, [role="textbox"]')) return false;
    event.preventDefault(); event.stopPropagation();
    if (this.cancelGesture) { this.cancelGesture(); return true; }
    this.history(key === 'z' && !event.shiftKey); return true;
  }
  private readonly root: HTMLElement; private tune: Tune; private readonly worklet: string; private readonly save: (t: Tune) => void;
  constructor(root: HTMLElement, tune: Tune, worklet: string, save: (t: Tune) => void) { this.root = root; this.tune = tune; this.worklet = worklet; this.save = save; root.classList.add('kmtune'); root.tabIndex = 0; root.addEventListener('keydown', this.onKey, true); this.fitTrack(); this.draw(); root.focus({ preventScroll: true });
    this.themeObserver = new MutationObserver(() => this.paint());
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] }); }
  private get pixelsPerBeat(): number { return Math.min(this.beatWidth, 30000 / (this.current.bars * this.tune.beats)); }
  private get current(): TuneSection { return this.tune.sections[this.section]!; }
  private get selected(): number { return this.primary; }
  private set selected(index: number) { this.primary = index; this.selection = new Set(index < 0 ? [] : [index]); }
  private selectNotes(indices: Iterable<number>, primary?: number): void {
    const notes = this.current.tracks[this.track]?.notes ?? [];
    this.selection = new Set([...indices].filter(index => !!notes[index]));
    this.primary = primary !== undefined && this.selection.has(primary) ? primary : [...this.selection][0] ?? -1;
  }
  private get drums(): boolean { return isPercussion(this.current.tracks[this.track]?.instrument ?? 'harp'); }
  private get kit(): boolean { return this.current.tracks[this.track]?.instrument === 'drums'; }
  private get rollHeight(): number { return this.kit ? 204 : this.drums ? 144 : 744; }
  private noteBox(note: TuneNote): Box {
    const lane = DRUM_LANES.findIndex(lane => lane.instrument === drumKind(note.midi));
    return { x: 64 + note.at * this.pixelsPerBeat, y: this.kit ? 34 + lane * 60 : this.drums ? 62 : 26 + (this.bottom + 35 - note.midi) * 20,
      width: note.duration * this.pixelsPerBeat, height: this.drums ? 40 : 16 };
  }
  private deleteNotes(): void {
    if (!this.selection.size) return;
    this.change(() => { const track = this.current.tracks[this.track]!; track.notes = track.notes.filter((_, i) => !this.selection.has(i)); this.selected = -1; }, true);
  }
  private copyNotes(): void {
    const notes = this.current.tracks[this.track]?.notes;
    if (notes && this.selection.size) this.clipboard = [...this.selection].sort((a, b) => a - b).map(index => clone(notes[index]!));
    this.draw();
  }
  private pasteNotes(): void {
    const track = this.current.tracks[this.track]; if (!track || !this.clipboard?.length) return;
    const start = Math.min(...this.clipboard.map(note => note.at)), end = Math.max(...this.clipboard.map(note => note.at + note.duration));
    const span = end - start, length = this.current.bars * this.tune.beats;
    if (span > length) { this.status = 'The copied notes are longer than this section.'; this.draw(); return; }
    this.change(() => {
      const at = Math.min(end, length - span), first = track.notes.length;
      for (const original of this.clipboard!) { const note = clone(original); note.at += at - start;
        if (this.kit) note.midi = snapDrumPitch(note.midi); else if (!this.drums) note.midi = snapPitch(note.midi, this.tune.key);
        track.notes.push(note);
      }
      this.selectNotes(track.notes.map((_, i) => i).slice(first));
    }, true);
  }
  private fitTrack(): void {
    const track = this.current.tracks[this.track];
    if (track?.notes.length) this.bottom = clamp(Math.min(...track.notes.map(n => n.midi)) - 8, 21, 73);
    else this.bottom = track?.instrument === 'bass' || track?.instrument === 'pulse-bass' || track?.instrument === 'drone' ? 24 : 48;
    this.scrollTop = this.drums ? 0 : 180;
  }
  private setInstrument(track: TuneTrack, instrument: TuneInstrument): void {
    if (instrument === track.instrument) return;
    if (instrument === 'custom') {
      const reference = track.notes[0] ?? { midi: 60, duration: 1, at: 0, velocity: 1 };
      track.patch ??= clone(reference.patch ?? { midi: reference.midi, duration: reference.duration, beatMs: 60000 / this.tune.bpm, parts: noteParts({ ...track, gain: 1, pan: 0 }, { ...reference, velocity: 1 }, 60000 / this.tune.bpm) });
    } else { delete track.patch; track.notes.forEach(note => { delete note.patch; }); }
    track.instrument = instrument; this.fitTrack();
  }
  private change(edit: () => void, keepPlayback = false): void {
    const before = this.snapshot();
    try { edit(); validateTune(this.tune); }
    catch (e) { this.restore(before); this.status = String(e); this.draw(false); return; }
    // Selection clicks and edits that snap back to the same value are not musical edits.
    if (JSON.stringify(before.tune) === JSON.stringify(this.tune)) { this.status = ''; this.draw(); return; }
    this.undo.push(before); if (this.undo.length > 100) this.undo.shift(); this.redo = [];
    if (keepPlayback) this.updatePreview(); else this.stop(); this.save(clone(this.tune)); this.status = ''; this.draw();
  }
  private history(back: boolean): void {
    const from = back ? this.undo : this.redo, to = back ? this.redo : this.undo, next = from.pop();
    if (!next) return; const keepPlayback = canUpdateTune(this.tune, next.tune); to.push(this.snapshot()); this.restore(next);
    if (keepPlayback) this.updatePreview(); else this.stop(); this.status = ''; this.save(clone(this.tune)); this.draw(false); this.root.focus({ preventScroll: true });
  }
  private snapshot(): HistoryEntry {
    const roll = this.root.querySelector('.km-roll-scroll');
    return { tune: clone(this.tune), section: this.section, track: this.track, selected: this.selected, selection: [...this.selection],
      arrangement: this.arrangementEntry ? this.tune.arrangement.indexOf(this.arrangementEntry) : -1,
      bottom: this.bottom, scrollTop: roll?.scrollTop ?? this.scrollTop, scrollLeft: roll?.scrollLeft ?? this.scrollLeft };
  }
  private restore(entry: HistoryEntry): void {
    this.tune = entry.tune; this.section = entry.section; this.track = entry.track; this.selectNotes(entry.selection, entry.selected);
    this.arrangementEntry = this.tune.arrangement[entry.arrangement]; this.bottom = entry.bottom;
    this.scrollTop = entry.scrollTop; this.scrollLeft = entry.scrollLeft;
    this.muted.clear(); this.solo = -1; this.addingTrack = false;
  }
  private el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; parent.append(el); return el;
  }
  private button(parent: HTMLElement, name: string, fn: () => void, disabled = false): HTMLButtonElement {
    const b = this.el(parent, 'button', name); b.type = 'button'; b.disabled = disabled; b.onclick = fn; return b;
  }
  private historyButton(parent: HTMLElement, back: boolean): HTMLButtonElement {
    const button = this.button(parent, back ? 'Undo' : 'Redo', () => {
      const input = this.root.ownerDocument.activeElement;
      if (input instanceof HTMLInputElement && this.root.contains(input) && input.value !== input.defaultValue) {
        const before = JSON.stringify(this.tune); input.blur();
        // An invalid pending value was already restored by validation.
        if (JSON.stringify(this.tune) === before) return;
      }
      this.history(back);
    }, !(back ? this.undo : this.redo).length);
    // Let click commit a focused field itself: blur normally rebuilds and removes this button
    // between pointerdown and click, swallowing the user's Undo.
    button.onpointerdown = event => { if (event.button === 0) event.preventDefault(); };
    button.title = back ? 'Undo (Ctrl/Cmd+Z)' : 'Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)';
    return button;
  }
  private input(parent: HTMLElement, label: string, value: string | number, fn: (value: string) => void, min?: number, max?: number, step = 1): HTMLInputElement {
    const wrap = this.el(parent, 'label', label); const i = this.el(wrap, 'input'); i.defaultValue = String(value); i.setAttribute('aria-label', label);
    if (typeof value === 'number') { i.type = 'number'; if (min !== undefined) i.min = String(min); if (max !== undefined) i.max = String(max); i.step = String(step); }
    i.onchange = () => fn(i.value);
    i.oninput = () => {
      const pending = i.value !== i.defaultValue;
      if (this.undoButton) this.undoButton.disabled = !this.undo.length && !pending;
      if (this.redoButton) this.redoButton.disabled = !this.redo.length || pending;
    }; return i;
  }
  private select(parent: HTMLElement, label: string, values: { value: string; label: string }[], current: string, fn: (v: string) => void): void {
    const wrap = this.el(parent, 'label', label), select = this.el(wrap, 'select'); select.setAttribute('aria-label', label);
    for (const value of values) { const o = this.el(select, 'option', value.label); o.value = value.value; } select.value = current; select.onchange = () => fn(select.value);
  }
  private chooseSection(index: number, entry?: Tune['arrangement'][number]): void {
    if (this.section !== index) { this.track = 0; this.selected = -1; this.muted.clear(); this.solo = -1; this.addingTrack = false; }
    this.section = index; this.arrangementEntry = entry; this.fitTrack(); this.draw();
  }
  private deleteTrack(index: number): void {
    this.change(() => { this.current.tracks.splice(index, 1); this.track = Math.max(0, Math.min(this.track > index ? this.track - 1 : this.track, this.current.tracks.length - 1)); this.selected = -1; this.muted.clear(); this.solo = -1; });
  }
  private draw(preserveScroll = true): void {
    const restoreFocus = this.root.contains(document.activeElement);
    const openSounds = new Set(Array.from(this.root.querySelectorAll<HTMLDetailsElement>('details[data-sound]')).filter(detail => detail.open).map(detail => detail.dataset.sound));
    this.section = Math.min(this.section, this.tune.sections.length - 1); this.track = Math.max(0, Math.min(this.track, this.current.tracks.length - 1));
    this.selectNotes(this.selection, this.selected);
    const arrangementScroll = this.root.querySelector('.km-arrangement')?.scrollLeft ?? 0;
    const oldScroll = this.root.querySelector('.km-roll-scroll');
    if (oldScroll && preserveScroll) { this.scrollTop = oldScroll.scrollTop; this.scrollLeft = oldScroll.scrollLeft; }
    this.root.replaceChildren();
    const topbar = this.el(this.root, 'div', '', 'km-topbar');
    this.el(topbar, 'span', 'KINGMAKER  /  MUSIC WORKSHOP');
    this.el(topbar, 'span', '.kmtune · Autosave', 'km-save');
    const heading = this.el(this.root, 'div', '', 'km-heading');
    const title = this.el(heading, 'div'); this.el(title, 'p', 'MUSIC', 'km-eyebrow');
    this.el(title, 'h1', this.tune.title);
    this.el(heading, 'span', `${this.tune.sections.length} ${this.tune.sections.length === 1 ? 'section' : 'sections'} · ${arrangementBeats(this.tune) / this.tune.beats} bars${this.tune.loop ? ' · Loop enabled' : ''}`, 'km-summary');
    const header = this.el(this.root, 'div', '', 'km-transport');
    const body = this.el(this.root, 'div', '', 'km-body');
    const library = this.el(body, 'aside', '', 'km-library'); library.setAttribute('aria-label', 'Sections and tracks');
    const workspace = this.el(body, 'div', '', 'km-workspace');
    const inspector = this.el(body, 'aside', '', 'km-inspector'); inspector.setAttribute('aria-label', 'Inspector');
    this.el(inspector, 'div', 'INSPECTOR', 'km-panel-head');
    const scoreSettings = this.el(inspector, 'div', '', 'km-settings');
    this.el(scoreSettings, 'p', 'SCORE', 'km-eyebrow');
    this.input(scoreSettings, 'Title', this.tune.title, v => this.change(() => { this.tune.title = v; }));
    this.input(header, 'BPM', this.tune.bpm, v => this.change(() => { this.tune.bpm = +v; }), 30, 300);
    this.input(header, 'Beats / bar', this.tune.beats, v => this.change(() => { this.tune.beats = +v; }), 1, 12);
    this.playButton = this.button(header, this.playing ? 'Stop' : 'Play arrangement', () => { if (this.playing) this.stop(); else void this.play(false); }); this.playButton.classList.add('km-primary');
    this.button(header, 'Play section', () => void this.play(true));
    this.undoButton = this.historyButton(header, true); this.redoButton = this.historyButton(header, false);
    this.el(library, 'div', 'SECTIONS', 'km-panel-head');
    const sections = this.el(library, 'div', '', 'km-section-list');
    this.tune.sections.forEach((s, i) => { const b = this.button(sections, s.name, () => this.chooseSection(i)); b.classList.toggle('km-active', i === this.section); b.setAttribute('aria-label', s.name); b.setAttribute('aria-pressed', String(i === this.section)); this.el(b, 'small', `${s.bars} ${s.bars === 1 ? 'bar' : 'bars'} · ${s.tracks.length} ${s.tracks.length === 1 ? 'track' : 'tracks'}`); });
    this.button(sections, '+ Section', () => this.change(() => { this.tune.sections.push({ id: crypto.randomUUID(), name: `Section ${this.tune.sections.length + 1}`, bars: 4, tracks: [{ name: 'Harp', instrument: 'harp', gain: 0.1, pan: 0, notes: [] }] }); this.section = this.tune.sections.length - 1; this.track = 0; this.selected = -1; }));
    const detail = this.el(inspector, 'div', '', 'km-settings'); this.el(detail, 'p', 'SECTION', 'km-eyebrow');
    this.input(detail, 'Section name', this.current.name, v => this.change(() => { this.current.name = v; }));
    this.input(detail, 'Bars', this.current.bars, v => this.change(() => { this.current.bars = +v; }), 1, 64);
    this.button(detail, 'Duplicate section', () => this.change(() => { const s = clone(this.current); s.id = crypto.randomUUID(); s.name += ' copy'; this.tune.sections.push(s); this.section = this.tune.sections.length - 1; }));
    const used = this.tune.arrangement.some(a => a.section === this.current.id);
    this.button(detail, 'Delete section', () => this.change(() => { this.tune.sections.splice(this.section, 1); this.section = 0; this.track = 0; }), used || this.tune.sections.length === 1);
    if (used) this.el(detail, 'small', 'Remove from the arrangement before deleting.');
    const arrangementPanel = this.el(workspace, 'section', '', 'km-arrangement-panel');
    const arrangementHeading = this.el(arrangementPanel, 'div', '', 'km-panel-head'); this.el(arrangementHeading, 'span', 'ARRANGEMENT'); this.el(arrangementHeading, 'small', 'Click a block to edit its section. Rename it here.');
    const arrangement = this.el(arrangementPanel, 'div', '', 'km-arrangement');
    this.tune.arrangement.forEach((a, i) => {
      const row = this.el(arrangement, 'div', '', 'km-arrangement-row');
      this.el(row, 'span', String(i + 1).padStart(2, '0'), 'km-index'); row.classList.toggle('km-looped', !!this.tune.loop && i >= this.tune.loop.from && i <= this.tune.loop.to);
      row.style.setProperty('--section-colour', ['#9878bb', '#629b88', '#b28a52', '#a5615c'][this.tune.sections.findIndex(s => s.id === a.section) % 4]!);
      const sectionIndex = this.tune.sections.findIndex(s => s.id === a.section), section = this.tune.sections[sectionIndex]!;
      const active = this.arrangementEntry === a && this.section === sectionIndex;
      row.classList.toggle('km-editing', active); row.setAttribute('role', 'group'); row.ariaLabel = `Arrangement row ${i + 1}: ${section.name}`;
      row.onclick = event => { if (!(event.target as HTMLElement).closest('input, select, button, label')) this.chooseSection(sectionIndex, a); };
      const name = this.input(row, `Name ${i + 1}`, section.name, value => this.change(() => {
        section.name = value.trim(); this.section = sectionIndex; this.arrangementEntry = a;
      }, true)); name.parentElement!.classList.add('km-arrangement-name'); name.parentElement!.firstChild!.textContent = 'Section name';
      name.onfocus = () => {
        if (this.arrangementEntry === a && this.section === sectionIndex) return;
        this.chooseSection(sectionIndex, a);
        const field = this.root.querySelector<HTMLInputElement>(`input[aria-label="Name ${i + 1}"]`);
        field?.focus({ preventScroll: true }); field?.select();
      };
      const edit = this.button(row, active ? 'Editing section' : 'Edit section', () => this.chooseSection(sectionIndex, a));
      edit.classList.add('km-edit-section'); edit.ariaLabel = `Edit section in row ${i + 1}`; edit.setAttribute('aria-pressed', String(active));
      this.select(row, `Use section ${i + 1}`, this.tune.sections.map(s => ({ value: s.id, label: s.name })), a.section, value => this.change(() => {
        a.section = value; this.section = this.tune.sections.findIndex(s => s.id === value); this.track = 0; this.selected = -1; this.muted.clear(); this.solo = -1; this.arrangementEntry = a;
      }));
      row.lastElementChild!.classList.add('km-section-reference'); row.lastElementChild!.firstChild!.textContent = 'Use section';
      const repeats = this.input(row, `Repeats ${i + 1}`, a.repeats, v => this.change(() => { a.repeats = +v; }), 1, 99); repeats.parentElement!.classList.add('km-repeat-count'); repeats.parentElement!.firstChild!.textContent = 'Repeats';
      this.button(row, '↑', () => this.change(() => { [this.tune.arrangement[i - 1], this.tune.arrangement[i]] = [a, this.tune.arrangement[i - 1]!]; }), i === 0).ariaLabel = `Move row ${i + 1} up`;
      this.button(row, '↓', () => this.change(() => { [this.tune.arrangement[i + 1], this.tune.arrangement[i]] = [a, this.tune.arrangement[i + 1]!]; }), i === this.tune.arrangement.length - 1).ariaLabel = `Move row ${i + 1} down`;
      this.button(row, 'Remove', () => this.change(() => { this.tune.arrangement.splice(i, 1); delete this.tune.loop; }), this.tune.arrangement.length === 1).ariaLabel = `Remove row ${i + 1}`;
    });
    this.button(arrangement, '+ Add selected section', () => this.change(() => { this.tune.arrangement.push({ section: this.current.id, repeats: 1 }); }));
    const loop = this.el(arrangementPanel, 'div', '', 'km-loop-controls');
    this.button(loop, this.tune.loop ? 'Disable loop' : 'Loop arrangement', () => this.change(() => { if (this.tune.loop) delete this.tune.loop; else this.tune.loop = { from: 0, to: this.tune.arrangement.length - 1 }; }));
    if (this.tune.loop) {
      this.input(loop, 'Loop from row', this.tune.loop.from + 1, v => this.change(() => { this.tune.loop!.from = +v - 1; }), 1, this.tune.arrangement.length);
      this.input(loop, 'Loop through row', this.tune.loop.to + 1, v => this.change(() => { this.tune.loop!.to = +v - 1; }), 1, this.tune.arrangement.length);
      this.el(loop, 'small', 'Intro once, then loop the selected rows.');
    }
    this.el(library, 'div', 'TRACKS', 'km-panel-head'); const tracks = this.el(library, 'div', '', 'km-track-list');
    if (this.current.tracks.some(track => ['kick', 'snare', 'hat'].includes(track.instrument))) {
      this.button(tracks, 'Merge drum tracks', () => this.change(() => {
        this.tune = mergeDrumTracks(this.tune); this.track = this.current.tracks.findIndex(track => track.instrument === 'drums'); this.selected = -1; this.fitTrack();
      }));
    }
    this.current.tracks.forEach((t, i) => {
      const row = this.el(tracks, 'div', '', 'km-track-row');
      const b = this.button(row, t.name, () => { this.track = i; this.selected = -1; this.fitTrack(); this.draw(); }); b.classList.add('km-track-select');
      b.classList.toggle('km-active', this.track === i); b.setAttribute('aria-label', t.name); b.setAttribute('aria-pressed', String(this.track === i)); this.el(b, 'small', `${INSTRUMENT_LABELS[t.instrument]} · ${t.notes.length} ${isPercussion(t.instrument) ? 'hits' : 'notes'}`);
      this.select(row, `Instrument for ${t.name}`, INSTRUMENTS.map(kind => ({ value: kind, label: INSTRUMENT_LABELS[kind] })), t.instrument, value => this.change(() => {
        this.track = i; this.setInstrument(t, value as TuneInstrument); this.selected = -1;
      }));
      row.lastElementChild!.classList.add('km-track-instrument'); row.lastElementChild!.firstChild!.textContent = 'Instrument';
      const remove = this.button(row, 'Delete', () => this.deleteTrack(i)); remove.classList.add('km-track-delete'); remove.ariaLabel = `Delete track ${t.name}`; remove.title = `Delete ${t.name} (Undo restores it)`;
    });
    const add = this.button(tracks, this.addingTrack ? 'Cancel add track' : '+ Track', () => { this.addingTrack = !this.addingTrack; this.draw(); }, this.current.tracks.length >= 16); add.setAttribute('aria-expanded', String(this.addingTrack));
    if (this.addingTrack) {
      const picker = this.el(tracks, 'div', '', 'km-instrument-picker'); picker.setAttribute('role', 'group'); picker.ariaLabel = 'Choose an instrument';
      this.el(picker, 'p', 'CHOOSE AN INSTRUMENT', 'km-eyebrow');
      for (const kind of INSTRUMENTS.filter(kind => !['kick', 'snare', 'hat'].includes(kind))) {
        const name = INSTRUMENT_LABELS[kind];
        const b = this.button(picker, name, () => this.change(() => {
          let title = name, suffix = 2; while (this.current.tracks.some(t => t.name === title)) title = `${name} ${suffix++}`;
          const created: TuneTrack = { name: title, instrument: kind, gain: kind === 'drums' || kind === 'custom' ? 1 : 0.08, pan: 0, notes: [] };
          if (kind === 'custom') created.patch = { midi: 60, duration: 1, beatMs: 60000 / this.tune.bpm, parts: [{ kind: 'tone', wave: 'triangle', freq: 261.625565, gain: 0.1, bus: 'music', env: { a: 5, d: 200, s: 0.6, hold: 400, r: 100 } }] };
          this.current.tracks.push(created);
          this.track = this.current.tracks.length - 1; this.selected = -1; this.addingTrack = false; this.fitTrack();
        }, true));
        b.ariaLabel = `Add ${name} track`;
      }
    }
    const track = this.current.tracks[this.track];
    if (track) {
      const settings = this.el(inspector, 'div', '', 'km-settings'); this.el(settings, 'p', 'INSTRUMENT', 'km-eyebrow');
      this.input(settings, 'Track name', track.name, v => this.change(() => { track.name = v; }));
      this.select(settings, 'Instrument', INSTRUMENTS.map(i => ({ value: i, label: INSTRUMENT_LABELS[i] })), track.instrument, v => this.change(() => { this.setInstrument(track, v as TuneInstrument); }));
      this.input(settings, 'Volume', track.gain, v => this.change(() => { track.gain = +v; }), 0, 1, 0.01);
      this.input(settings, 'Pan', track.pan, v => this.change(() => { track.pan = +v; }), -1, 1, 0.1);
      if (track.patch) this.patchEditor(settings, track.patch, 'Track sound', patch => { track.patch = patch; });
      if (track.notes.some(n => n.patch)) this.el(settings, 'small', 'Imported notes keep their original sound recipes. Select a note to edit its sound. Changing the instrument replaces those recipes.');
      this.button(settings, this.muted.has(this.track) ? 'Unmute preview' : 'Mute preview', () => { if (this.muted.has(this.track)) this.muted.delete(this.track); else this.muted.add(this.track); this.stop(); this.draw(); });
      this.button(settings, this.solo === this.track ? 'Unsolo preview' : 'Solo preview', () => { this.solo = this.solo === this.track ? -1 : this.track; this.stop(); this.draw(); });
      this.button(settings, 'Delete track', () => this.deleteTrack(this.track));
      const rollHeading = this.el(workspace, 'div', '', 'km-roll-heading'); this.el(rollHeading, 'h2', this.current.name); this.el(rollHeading, 'span', `${track.name} / ${INSTRUMENT_LABELS[track.instrument]}`, 'km-summary');
      const edit = this.el(workspace, 'div', '', 'km-editbar');
      const modes = this.el(edit, 'div', '', 'km-roll-tools'); modes.setAttribute('role', 'group'); modes.ariaLabel = 'Editing tool';
      for (const [mode, label] of [['draw', 'Draw notes'], ['select', 'Box select']] as const) {
        const button = this.button(modes, label, () => { this.tool = mode; this.draw(); }); button.setAttribute('aria-pressed', String(this.tool === mode));
      }
      this.select(edit, 'Snap', [1, 0.5, 0.25].map(v => ({ value: String(v), label: `${v} beat` })), String(this.snap), v => { this.snap = +v; this.draw(); });
      if (!this.drums) {
        this.select(edit, 'Root note', noteNames.map((label, root) => ({ value: String(root), label })), String(this.tune.key?.root ?? 0), value => this.change(() => { this.tune.key = { root: +value, scale: this.tune.key?.scale ?? 'chromatic' }; }, true));
        this.select(edit, 'Scale', Object.keys(SCALES).map(value => ({ value, label: value === 'chromatic' ? 'All notes' : value[0]!.toUpperCase() + value.slice(1) })), this.tune.key?.scale ?? 'chromatic', value => this.change(() => { this.tune.key = { root: this.tune.key?.root ?? 0, scale: value as keyof typeof SCALES }; }, true));
        this.input(settings, 'Lowest MIDI pitch', this.bottom, v => { this.bottom = clamp(Math.round(+v || 48), 21, 73); this.draw(); }, 21, 73);
        if (this.tune.key && this.tune.key.scale !== 'chromatic') this.el(settings, 'small', `New and moved notes snap to ${noteNames[this.tune.key.root]} ${this.tune.key.scale}. Existing notes stay as written.`);
      } else this.el(settings, 'small', this.kit ? 'One kit: kick, snare and hi-hat. Draw hits on each row; box-select and move patterns together.' : 'Drum lane: drag empty space to draw a hit. Merge drum tracks to edit the complete kit together.');
      this.select(edit, 'Zoom', [48, 72, 96].map(v => ({ value: String(v), label: `${Math.round(v / 72 * 100)}%` })), String(this.beatWidth), v => { this.beatWidth = +v; this.draw(); });
      this.button(edit, this.selection.size > 1 ? 'Copy notes' : 'Copy note', () => this.copyNotes(), !this.selection.size);
      this.button(edit, (this.clipboard?.length ?? 0) > 1 ? 'Paste notes' : 'Paste note', () => this.pasteNotes(), !this.clipboard?.length);
      this.button(edit, this.selection.size > 1 ? 'Delete notes' : 'Delete note', () => this.deleteNotes(), !this.selection.size);
      this.el(edit, 'span', this.selection.size ? `${this.selection.size} ${this.selection.size === 1 ? 'note' : 'notes'} selected` : 'No notes selected', 'km-selection-count');

      const scroll = this.el(workspace, 'div', '', 'km-roll-scroll'); const roll = this.el(scroll, 'div', '', 'km-roll');
      const ruler = this.el(roll, 'div', '', 'km-ruler');
      ruler.style.width = `${64 + this.current.bars * this.tune.beats * this.pixelsPerBeat}px`;
      for (let bar = 0; bar < this.current.bars; bar++) { const label = this.el(ruler, 'span', String(bar + 1)); label.style.left = `${68 + bar * this.tune.beats * this.pixelsPerBeat}px`; }
      const canvas = this.el(roll, 'canvas'); canvas.width = 64 + this.current.bars * this.tune.beats * this.pixelsPerBeat; canvas.dataset.beatWidth = String(this.pixelsPerBeat); canvas.height = this.rollHeight; canvas.setAttribute('aria-label', this.kit ? 'Drum kit sequencer' : this.drums ? `${INSTRUMENT_LABELS[track.instrument]} drum lane` : 'Piano roll'); canvas.tabIndex = 0; canvas.style.cursor = this.tool === 'draw' ? 'crosshair' : 'default'; this.canvas = canvas;
      this.playhead = this.el(roll, 'div', '', 'km-playhead'); this.playhead.hidden = true;
      this.paint(); this.bindRoll(canvas); scroll.scrollTop = this.scrollTop; scroll.scrollLeft = this.scrollLeft;
      if (this.selection.size > 1) {
        const group = this.el(inspector, 'div', '', 'km-settings km-note-settings'); this.el(group, 'p', `${this.selection.size} NOTES SELECTED`, 'km-eyebrow');
        this.el(group, 'small', 'Drag a selected note to move the group, or a right edge to resize it. Shift-click adds or removes a note. Escape clears the selection.');
      }
      const n = this.selection.size === 1 ? track.notes[this.selected] : undefined;
      if (n) { const notePanel = this.el(inspector, 'div', '', 'km-settings km-note-settings'); this.el(notePanel, 'p', this.drums ? `HIT · ${INSTRUMENT_LABELS[track.instrument]}` : `NOTE · ${pitch(n.midi)}`, 'km-eyebrow');
        if (!this.drums) this.input(notePanel, 'Note MIDI', n.midi, v => this.change(() => { n.midi = snapPitch(+v, this.tune.key); }, true), 21, 108);
        this.input(notePanel, 'Start beat', n.at, v => this.change(() => { n.at = +v; }, true), 0, this.current.bars * this.tune.beats, this.snap);
        this.input(notePanel, 'Duration', n.duration, v => this.change(() => { n.duration = +v; }, true), 0.001, 64, this.snap);
        this.input(notePanel, 'Velocity', n.velocity, v => this.change(() => { n.velocity = +v; }, true), 0, 1, 0.05);
        if (n.patch) {
          this.patchEditor(notePanel, n.patch, 'Note sound', patch => { n.patch = patch; });
          this.button(notePanel, 'Use track sound', () => this.change(() => { delete n.patch; }), track.instrument === 'custom' && !track.patch);
        } else this.button(notePanel, 'Customize note sound', () => this.change(() => {
          n.patch = { midi: n.midi, duration: n.duration, beatMs: 60000 / this.tune.bpm, parts: noteParts({ ...track, gain: 1, pan: 0 }, { ...n, velocity: 1 }, 60000 / this.tune.bpm) };
        }));
      }
    }
    const footer = this.el(this.root, 'div', '', 'km-statusbar');
    const status = this.el(footer, 'span', this.status || (this.tool === 'draw' ? 'Draw: drag empty space for length · Shift-drag to select · Space: play / stop' : 'Select: drag a box · Shift adds · Drag selected notes to move · Delete removes'), this.status ? 'km-error' : ''); status.setAttribute('role', 'status');
    this.el(footer, 'span', 'Edits save automatically');
    arrangement.scrollLeft = arrangementScroll;
    for (const detail of this.root.querySelectorAll<HTMLDetailsElement>('details[data-sound]')) detail.open = openSounds.has(detail.dataset.sound);
    if (restoreFocus) this.root.focus({ preventScroll: true });
  }
  /** Common controls cover everyday sound design; the validated recipe exposes every DSP feature. */
  private patchEditor(parent: HTMLElement, patch: TunePatch, label: string, set: (patch: TunePatch) => void): void {
    const details = this.el(parent, 'details', '', 'km-patch'); details.dataset.sound = label;
    this.el(details, 'summary', `${label} · ${patch.parts.length} ${patch.parts.length === 1 ? 'voice' : 'voices'}`);
    this.el(details, 'small', 'Pitch and duration follow the note. Values below describe the original sound.');
    const edit = (mutate: (copy: TunePatch) => void) => this.change(() => { const next = clone(patch); mutate(next); set(next); });
    this.input(details, `${label} reference MIDI`, patch.midi, value => edit(next => { next.midi = +value; }), 21, 108);
    this.input(details, `${label} reference beats`, patch.duration, value => edit(next => { next.duration = +value; }), 0.001, 64, 0.25);
    patch.parts.forEach((part, index) => {
      const voice = this.el(details, 'details', '', 'km-patch-voice'); voice.dataset.sound = `${label} voice ${index}`; this.el(voice, 'summary', `Voice ${index + 1} · ${part.kind}`);
      const change = (key: string, value: unknown) => edit(next => { Object.assign(next.parts[index]!, { [key]: value }); });
      if (part.kind === 'tone') this.select(voice, `${label} voice ${index + 1} waveform`, ['sine', 'triangle', 'square', 'pulse', 'saw'].map(value => ({ value, label: value })), part.wave, value => change('wave', value));
      if (part.kind === 'noise') this.select(voice, `${label} voice ${index + 1} filter`, [{ value: 'lp', label: 'Low pass' }, { value: 'bp', label: 'Band pass' }, { value: 'hp', label: 'High pass' }], part.filter, value => change('filter', value));
      this.input(voice, `${label} voice ${index + 1} frequency`, part.freq, value => change('freq', +value), 1, 96000, 1);
      this.input(voice, `${label} voice ${index + 1} gain`, part.gain, value => change('gain', +value), 0, 4, 0.01);
      this.input(voice, `${label} voice ${index + 1} room`, part.room ?? 0, value => change('room', +value), 0, 1, 0.05);
      for (const [key, name, fallback] of [['a', 'Attack ms', 2], ['d', 'Decay ms', 120], ['s', 'Sustain level', 0], ['hold', 'Hold ms', 0], ['r', 'Release ms', 0]] as const) this.input(voice, `${label} voice ${index + 1} ${name}`, part.env[key] ?? fallback, value => edit(next => { next.parts[index]!.env[key] = +value; }), 0, key === 's' ? 1 : 120000, key === 's' ? 0.05 : 1);
      this.button(voice, `Remove voice ${index + 1}`, () => edit(next => { next.parts.splice(index, 1); }), patch.parts.length === 1);
    });
    for (const kind of ['tone', 'noise', 'pluck'] as const) this.button(details, `Add ${kind} voice`, () => edit(next => {
      const common = { freq: 261.625565, gain: 0.1, bus: 'music' as const, env: { a: 2, d: 180 } };
      next.parts.push(kind === 'tone' ? { ...common, kind, wave: 'triangle' } : kind === 'noise' ? { ...common, kind, filter: 'bp', freq: 1800 } : { ...common, kind, decay: 1.1, bright: 0.3 });
    }));
    const raw = this.el(details, 'details'); raw.dataset.sound = `${label} raw`; this.el(raw, 'summary', 'Full sound recipe');
    this.el(raw, 'small', 'All synthesis controls, including glide, filters, vibrato, FM, stereo position and delayed voices. Apply validates the recipe before saving.');
    const json = this.el(raw, 'textarea'); json.ariaLabel = `${label} recipe JSON`; json.value = JSON.stringify(patch, null, 2); json.spellcheck = false;
    this.button(raw, `Apply ${label.toLowerCase()} recipe`, () => this.change(() => { set(JSON.parse(json.value) as TunePatch); }));
  }
  private paint(preview?: RollPreview): void {
    const c = this.canvas; if (!c) return; const ctx = c.getContext('2d')!;
    const style = getComputedStyle(this.root);
    const colour = (key: string) => style.getPropertyValue(key).trim();
    ctx.fillStyle = colour('--km-bg'); ctx.fillRect(0, 0, c.width, c.height); ctx.font = '11px monospace';
    if (this.kit) {
      DRUM_LANES.forEach((lane, index) => {
        const y = 24 + index * 60; ctx.fillStyle = colour(index % 2 ? '--km-bg' : '--km-panel'); ctx.fillRect(64, y, c.width - 64, 59);
        ctx.fillStyle = colour('--km-key-dark'); ctx.fillRect(0, y, 62, 59); ctx.fillStyle = colour('--km-key-dark-text'); ctx.fillText(lane.label, 7, y + 34);
      });
    } else if (this.drums) {
      ctx.fillStyle = colour('--km-panel'); ctx.fillRect(64, 24, c.width - 64, 119);
      ctx.fillStyle = colour('--km-key-dark'); ctx.fillRect(0, 24, 62, 119);
      ctx.fillStyle = colour('--km-key-dark-text'); ctx.fillText(INSTRUMENT_LABELS[this.current.tracks[this.track]!.instrument], 7, 88);
    }
    for (let row = 0; !this.drums && row < 36; row++) { const midi = this.bottom + 35 - row, y = 24 + row * 20;
      const black = [1, 3, 6, 8, 10].includes(midi % 12);
      ctx.fillStyle = black ? colour('--km-bg') : colour('--km-panel'); ctx.fillRect(64, y, c.width - 64, 19);
      ctx.fillStyle = black ? colour('--km-key-dark') : colour('--km-key-light'); ctx.fillRect(0, y, black ? 48 : 62, 19);
      ctx.fillStyle = black ? colour('--km-key-dark-text') : colour('--km-key-light-text'); ctx.fillText(pitch(midi), 12, y + 14);
      if (!inScale(midi, this.tune.key)) { ctx.globalAlpha = 0.72; ctx.fillStyle = colour('--km-bg'); ctx.fillRect(0, y, c.width, 19); ctx.globalAlpha = 1; }
    }
    for (let beat = 0; beat <= this.current.bars * this.tune.beats; beat += this.snap) {
      const x = 64 + beat * this.pixelsPerBeat; ctx.strokeStyle = colour('--km-line'); ctx.globalAlpha = beat % this.tune.beats === 0 ? 1 : 0.35; ctx.beginPath(); ctx.moveTo(x, 24); ctx.lineTo(x, c.height); ctx.stroke(); ctx.globalAlpha = 1;
      if (beat % this.tune.beats === 0) { ctx.fillStyle = colour('--km-muted'); ctx.fillText(String(beat / this.tune.beats + 1), x + 4, 15); }
    }
    const drawNote = (note: TuneNote, selected: boolean) => {
      if (!this.drums && (note.midi < this.bottom || note.midi > this.bottom + 35)) return;
      const box = this.noteBox(note);
      ctx.fillStyle = colour(selected ? '--km-selected-note' : '--km-note');
      ctx.beginPath(); ctx.roundRect(box.x + 1, box.y, Math.max(2, box.width - 2), box.height, 3); ctx.fill();
      ctx.fillStyle = colour('--km-note-text'); if (note.duration >= 0.5) ctx.fillText(this.drums ? `${Math.round(note.velocity * 100)}%` : pitch(note.midi), box.x + 4, box.y + (this.drums ? 24 : 12));
    };
    this.current.tracks[this.track]?.notes.forEach((note, index) => drawNote(preview?.notes?.get(index) ?? note, this.selection.has(index)));
    if (preview?.added) { ctx.globalAlpha = 0.75; drawNote(preview.added, true); ctx.globalAlpha = 1; }
    if (preview?.box) {
      const { x, y, width, height } = preview.box;
      ctx.fillStyle = colour('--km-selected-note'); ctx.globalAlpha = 0.14; ctx.fillRect(x, y, width, height); ctx.globalAlpha = 1;
      ctx.strokeStyle = colour('--km-selected-note'); ctx.setLineDash([4, 3]); ctx.strokeRect(x + 0.5, y + 0.5, width, height); ctx.setLineDash([]);
    }
  }
  private bindRoll(canvas: HTMLCanvasElement): void {
    const point = (event: PointerEvent | MouseEvent) => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
    const hit = (x: number, y: number) => this.current.tracks[this.track]!.notes.findLastIndex(note => {
      const box = this.noteBox(note); return x >= box.x && x < box.x + box.width && y >= box.y - 2 && y < box.y + box.height + 2;
    });
    canvas.oncontextmenu = event => {
      event.preventDefault(); const p = point(event), index = hit(p.x, p.y);
      if (index >= 0) { if (!this.selection.has(index)) this.selected = index; this.deleteNotes(); this.root.focus({ preventScroll: true }); }
    };
    canvas.onpointerdown = event => {
      if (event.button !== 0) return; const p = point(event);
      if (p.x < 64 || p.y < 24 || p.y >= canvas.height) return;
      event.preventDefault(); canvas.focus({ preventScroll: true });
      const track = this.current.tracks[this.track]!, length = this.current.bars * this.tune.beats, index = hit(p.x, p.y);
      const selectionBefore = [...this.selection], primaryBefore = this.selected;
      if (index >= 0 && event.shiftKey) {
        const selected = new Set(this.selection); if (selected.has(index)) selected.delete(index); else selected.add(index);
        this.selectNotes(selected, index); this.draw(); return;
      }
      canvas.setPointerCapture(event.pointerId);
      const cleanup = () => {
        canvas.onpointermove = null; canvas.onpointerup = null; canvas.onpointercancel = null; canvas.onlostpointercapture = null; this.cancelGesture = undefined;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      this.cancelGesture = () => { cleanup(); this.selectNotes(selectionBefore, primaryBefore); this.draw(); this.root.focus({ preventScroll: true }); };
      canvas.onpointercancel = () => this.cancelGesture?.(); canvas.onlostpointercapture = () => this.cancelGesture?.();
      if (index < 0 && (this.tool === 'select' || event.shiftKey)) {
        const base = event.shiftKey ? selectionBefore : [];
        const update = (q: {x: number; y: number}) => {
          const x = clamp(q.x, 64, canvas.width), y = clamp(q.y, 24, canvas.height);
          const box = { x: Math.min(p.x, x), y: Math.min(p.y, y), width: Math.abs(x - p.x), height: Math.abs(y - p.y) };
          const indices = box.width > 0 && box.height > 0 ? track.notes.flatMap((note, i) => {
            const r = this.noteBox(note); return r.x < box.x + box.width && r.x + r.width > box.x && r.y < box.y + box.height && r.y + r.height > box.y ? [i] : [];
          }) : [];
          this.selectNotes([...base, ...indices]); this.paint({ box });
        };
        update(p); canvas.onpointermove = move => update(point(move));
        canvas.onpointerup = up => { update(point(up)); cleanup(); this.draw(); this.root.focus({ preventScroll: true }); }; return;
      }
      if (index < 0) {
        const start = clamp(Math.floor((p.x - 64) / this.pixelsPerBeat / this.snap) * this.snap, 0, length - this.snap);
        const midi = this.kit ? DRUM_LANES[clamp(Math.floor((p.y - 24) / 60), 0, 2)]!.midi : this.drums ? 60 : snapPitch(this.bottom + 35 - Math.floor((p.y - 24) / 20), this.tune.key);
        let note: TuneNote = { at: start, midi, duration: this.snap, velocity: 0.8,
          ...(track.instrument === 'custom' && !track.patch && track.notes[0]?.patch ? { patch: clone(track.notes[0].patch) } : {}) };
        const update = (q: {x: number}) => {
          const end = clamp(Math.round((q.x - 64) / this.pixelsPerBeat / this.snap) * this.snap, 0, length);
          note = end < start ? { ...note, at: Math.max(end, start - 64), duration: Math.min(64, start - end) }
            : { ...note, at: start, duration: Math.min(64, length - start, Math.max(this.snap, end - start)) };
          this.paint({ added: note });
        };
        this.paint({ added: note }); canvas.onpointermove = move => update(point(move));
        canvas.onpointerup = up => { update(point(up)); cleanup(); this.change(() => { track.notes.push(note); this.selected = track.notes.length - 1; }, true); this.root.focus({ preventScroll: true }); }; return;
      }
      if (!this.selection.has(index)) this.selected = index; else this.primary = index;
      const originals = new Map([...this.selection].map(i => [i, clone(track.notes[i]!)])), notes = [...originals.values()];
      const clicked = track.notes[index]!, resize = p.x >= 64 + (clicked.at + clicked.duration) * this.pixelsPerBeat - 8;
      let next = originals;
      const update = (q: {x: number; y: number}) => {
        const raw = Math.round((q.x - p.x) / this.pixelsPerBeat / this.snap) * this.snap;
        const delta = resize ? clamp(raw, this.snap - Math.min(...notes.map(n => n.duration)), Math.min(...notes.map(n => Math.min(64 - n.duration, length - n.at - n.duration))))
          : clamp(raw, -Math.min(...notes.map(n => n.at)), length - Math.max(...notes.map(n => n.at + n.duration)));
        const semitones = clamp(Math.round((p.y - q.y) / 20), 21 - Math.min(...notes.map(n => n.midi)), 108 - Math.max(...notes.map(n => n.midi)));
        const lanes = notes.map(n => DRUM_LANES.findIndex(lane => lane.instrument === drumKind(n.midi)));
        const laneDelta = clamp(Math.round((q.y - p.y) / 60), -Math.min(...lanes), 2 - Math.max(...lanes));
        next = new Map([...originals].map(([i, note]) => [i, resize ? { ...note, duration: note.duration + delta }
          : { ...note, at: note.at + delta, midi: this.kit ? DRUM_LANES[DRUM_LANES.findIndex(lane => lane.instrument === drumKind(note.midi)) + laneDelta]!.midi : this.drums ? note.midi : snapPitch(note.midi + semitones, this.tune.key) }]));
        this.paint({ notes: next });
      };
      this.paint(); canvas.onpointermove = move => update(point(move));
      canvas.onpointerup = () => { cleanup(); this.change(() => { for (const [i, note] of next) track.notes[i] = note; }, true); this.root.focus({ preventScroll: true }); };
    };
  }
  private previewScore(): Tune {
    const score = clone(this.tune), filter = this.previewFilter!;
    if (this.sectionPlayback) { score.arrangement = [{ section: filter.section, repeats: 1 }]; score.loop = { from: 0, to: 0 }; }
    score.sections.find(section => section.id === filter.section)?.tracks.forEach((track, index) => {
      if (filter.muted.has(index) || (filter.solo >= 0 && index !== filter.solo)) track.gain = 0;
    });
    return score;
  }
  private updatePreview(): void {
    if (this.node && this.previewFilter) this.node.port.postMessage([{ type: 'tune-update', tune: this.previewScore() }]);
  }
  private async play(sectionOnly: boolean): Promise<void> {
    this.stop(); this.sectionPlayback = sectionOnly; const generation = this.generation;
    this.previewFilter = { section: this.current.id, muted: new Set(this.muted), solo: this.solo };
    const ctx = new AudioContext(); this.audio = ctx;
    try {
      await ctx.resume(); await ctx.audioWorklet.addModule(this.worklet);
      if (generation !== this.generation || this.destroyed) return;
      const score = this.previewScore();
      const node = new AudioWorkletNode(ctx, 'kingmaker-sound', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { seed: 1, messages: [{ type: 'music', mood: 'title', tune: score }] } });
      this.node = node; node.connect(ctx.destination); this.playing = true; if (this.playButton) this.playButton.textContent = 'Stop';
      const started = ctx.currentTime + 0.5;
      const tick = () => {
        if (!this.playing) return;
        const beat = Math.max(0, (ctx.currentTime - started) * score.bpm / 60); const position = positionAt(score, beat);
        if (!position) { if (ctx.currentTime > started + arrangementBeats(score) * 60 / score.bpm + 3) { this.stop(); return; } }
        if (this.playhead) { this.playhead.hidden = !position || position.section !== this.current.id; if (position) this.playhead.style.left = `${64 + position.beat * this.pixelsPerBeat}px`; }
        this.frame = requestAnimationFrame(tick);
      }; tick();
    } catch (e) { if (generation === this.generation) { this.stop(); this.status = `Preview failed: ${e}`; this.draw(); } }
  }
  private stop(): void {
    this.generation++; this.playing = false; cancelAnimationFrame(this.frame); this.node?.disconnect(); this.node = undefined; this.previewFilter = undefined;
    if (this.audio) void this.audio.close().catch(() => {}); this.audio = undefined;
    if (this.playButton) this.playButton.textContent = 'Play arrangement'; if (this.playhead) this.playhead.hidden = true;
  }
  destroy(): void { this.root.removeEventListener('keydown', this.onKey, true); this.themeObserver?.disconnect(); this.destroyed = true; this.stop(); this.root.replaceChildren(); }
}
function entryBeats(t: Tune, index: number): number { const a = t.arrangement[index]!; return t.sections.find(s => s.id === a.section)!.bars * t.beats * a.repeats; }
export function arrangementBeats(t: Tune): number { return t.arrangement.reduce((n, _, i) => n + entryBeats(t, i), 0); }
export function positionAt(t: Tune, beat: number): { section: string; beat: number } | undefined {
  if (t.loop) {
    let start = 0, length = 0;
    t.arrangement.forEach((_, i) => { if (i < t.loop!.from) start += entryBeats(t, i); else if (i <= t.loop!.to) length += entryBeats(t, i); });
    if (beat >= start) beat = start + (beat - start) % length;
  }
  for (let i = 0; i < t.arrangement.length; i++) { const a = t.arrangement[i]!, duration = entryBeats(t, i); if (beat < duration) return { section: a.section, beat: beat % (duration / a.repeats) }; beat -= duration; }
  return undefined;
}
