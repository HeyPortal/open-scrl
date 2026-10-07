import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useExport } from '@/editor/exportStore';
import { useEditorView } from '@/editor/viewStore';
import { currentSelection, enteredGroupId, selectParent } from '@/editor/selectionActions';
import { expandToGroups, groupMemberIds, selectionUnits } from '@/core/document/selectors';
import type { AlignEdge, DistributeAxis } from '@/core/document/geometry';
import { useToasts } from '@/store/toasts';
import { GRID_TEMPLATES } from '@/lib/grids';
import type { Layer } from '@/types';

export type ActionGroup = 'Insert' | 'Edit' | 'Arrange' | 'Slide' | 'View' | 'Panels' | 'Project' | 'Export' | 'Grids';

/** A key combination. `mod` is ⌘ on macOS and Ctrl elsewhere. */
export interface KeyBinding {
  key?: string;
  code?: string;
  mod?: boolean;
  /** Omit to accept either state (e.g. for keys that already imply Shift, like `?`). */
  shift?: boolean;
  /** Also fire while typing in a text field. */
  global?: boolean;
}

export interface Action {
  id: string;
  label: string;
  group: ActionGroup;
  keys?: KeyBinding[];
  keywords?: string;
  /** Hidden from the command palette (still reachable by shortcut). */
  hidden?: boolean;
  enabled?: () => boolean;
  run: () => void;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function formatBinding(binding: KeyBinding): string[] {
  const parts: string[] = [];
  if (binding.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  if (binding.shift) parts.push('⇧');
  const names: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Delete: 'Del', Backspace: '⌫',
    PageUp: 'PgUp', PageDown: 'PgDn', '\\': '\\', Digit0: '0', Digit1: '1', '{': '[', '}': ']', '+': '+',
  };
  const key = binding.code ?? binding.key ?? '';
  parts.push(names[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return parts;
}

export function matchesBinding(binding: KeyBinding, e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>) {
  if (e.altKey) return false;
  if (!!binding.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (binding.shift !== undefined && binding.shift !== e.shiftKey) return false;
  if (binding.code) return binding.code === e.code;
  return !!binding.key && binding.key.toLowerCase() === e.key.toLowerCase();
}

const doc = () => useEditor.getState();
const session = () => useEditorSession.getState();
const selection = () => currentSelection(doc().doc);
const selectedLayers = (): Layer[] => selection().map((id) => doc().doc.layers[id]);
const hasLayer = () => selection().length > 0;
const hasUnlockedLayer = () => selectedLayers().some((l) => !l.locked);
const unitCount = () => selectionUnits(doc().doc, selection()).length;
/** Grouping needs two or more layers that aren't already exactly one group. */
const canGroup = () => {
  const d = doc().doc;
  const ids = expandToGroups(d, selection());
  if (ids.length < 2) return false;
  const group = d.layers[ids[0]].groupId;
  return !(group && ids.every((id) => d.layers[id].groupId === group) && groupMemberIds(d, ids[0]).length === ids.length && !enteredGroupId(d));
};
const canUngroup = () => selectedLayers().some((l) => !!l.groupId);
const slideIndex = () => Math.max(0, doc().doc.slideOrder.indexOf(session().selectedSlideId));
const currentSlideId = () => doc().doc.slideOrder[slideIndex()];
const focusSlideAt = (index: number) => {
  const order = doc().doc.slideOrder;
  const id = order[Math.max(0, Math.min(order.length - 1, index))];
  if (id) session().focusSlide(id);
};
const zoomTo = (zoom: number) => session().setZoom(zoom);

export function nudgeSelected(dx: number, dy: number) {
  const ids = selectedLayers().filter((l) => !l.locked).map((l) => l.id);
  if (!ids.length) return;
  doc().moveLayers(ids, dx, dy, `nudge:${ids.join(',')}`);
}

/** Aligns the selection's edges to each other, or a single layer or group to the slide. */
export function alignSelection(edge: AlignEdge, relativeTo?: 'selection' | 'slide') {
  doc().alignLayers(selection(), edge, relativeTo);
}

export function distributeSelection(axis: DistributeAxis) {
  doc().distributeLayers(selection(), axis);
}

/** Lock or hide the whole selection in one step; mixed selections switch everything on. */
function toggleAll(key: 'locked' | 'visible') {
  const layers = selectedLayers();
  if (!layers.length) return;
  const value = key === 'locked' ? !layers.every((l) => l.locked) : !layers.every((l) => l.visible);
  doc().updateLayers(layers.map((l) => ({ id: l.id, patch: { [key]: value } })));
}

const ALIGN_ACTIONS: { id: string; edge: AlignEdge; label: string; keywords: string }[] = [
  { id: 'align-left', edge: 'left', label: 'Align left', keywords: 'left edges slide' },
  { id: 'align-center', edge: 'centerX', label: 'Align centers horizontally', keywords: 'center middle slide' },
  { id: 'align-right', edge: 'right', label: 'Align right', keywords: 'right edges slide' },
  { id: 'align-top', edge: 'top', label: 'Align top', keywords: 'top edges slide' },
  { id: 'align-middle', edge: 'centerY', label: 'Align centers vertically', keywords: 'middle center slide' },
  { id: 'align-bottom', edge: 'bottom', label: 'Align bottom', keywords: 'bottom edges slide' },
];

export function buildActions(): Action[] {
  const toast = useToasts.getState().addToast;
  const actions: Action[] = [
    // Insert
    { id: 'add-text', label: 'Add text', group: 'Insert', keys: [{ key: 't', shift: false }], run: () => doc().addTextLayer() },
    { id: 'add-rect', label: 'Add rectangle', group: 'Insert', keys: [{ key: 'r', shift: false }], keywords: 'shape box', run: () => doc().addShapeLayer('rect') },
    { id: 'add-ellipse', label: 'Add ellipse', group: 'Insert', keys: [{ key: 'o', shift: false }], keywords: 'shape circle oval', run: () => doc().addShapeLayer('ellipse') },
    { id: 'import-media', label: 'Import media…', group: 'Insert', keywords: 'photo image video gif upload', run: () => session().requestImport() },

    // Edit
    { id: 'undo', label: 'Undo', group: 'Edit', keys: [{ key: 'z', mod: true, shift: false, global: true }], enabled: () => doc().past.length > 0, run: () => doc().undo() },
    { id: 'redo', label: 'Redo', group: 'Edit', keys: [{ key: 'z', mod: true, shift: true, global: true }, { key: 'y', mod: true, global: true }], enabled: () => doc().future.length > 0, run: () => doc().redo() },
    { id: 'select-all', label: 'Select all layers', group: 'Edit', keys: [{ key: 'a', mod: true, shift: false }], keywords: 'everything', run: () => doc().selectAllLayers() },
    { id: 'duplicate-layer', label: 'Duplicate', group: 'Edit', keys: [{ key: 'd', mod: true }], keywords: 'copy layer', enabled: hasLayer, run: () => { doc().duplicateLayers(selection()); } },
    { id: 'delete-layer', label: 'Delete', group: 'Edit', keys: [{ key: 'Delete' }, { key: 'Backspace' }], keywords: 'remove layer', enabled: hasLayer, run: () => doc().deleteLayers(selection()) },
    { id: 'toggle-lock', label: 'Lock / unlock', group: 'Edit', keywords: 'layer', enabled: hasLayer, run: () => toggleAll('locked') },
    { id: 'toggle-visible', label: 'Show / hide', group: 'Edit', keywords: 'layer', enabled: hasLayer, run: () => toggleAll('visible') },
    { id: 'deselect', label: 'Deselect', group: 'Edit', keys: [{ key: 'Escape' }], hidden: true, enabled: hasLayer, run: selectParent },

    // Arrange
    { id: 'group', label: 'Group', group: 'Arrange', keys: [{ key: 'g', mod: true, shift: false }], keywords: 'combine layers', enabled: canGroup, run: () => { doc().groupLayers(selection()); } },
    { id: 'ungroup', label: 'Ungroup', group: 'Arrange', keys: [{ key: 'g', mod: true, shift: true }], keywords: 'split layers', enabled: canUngroup, run: () => doc().ungroupLayers(selection()) },
    { id: 'bring-forward', label: 'Bring forward', group: 'Arrange', keys: [{ key: ']', shift: false }], enabled: hasLayer, run: () => doc().reorderLayers(selection(), 'up') },
    { id: 'send-backward', label: 'Send backward', group: 'Arrange', keys: [{ key: '[', shift: false }], enabled: hasLayer, run: () => doc().reorderLayers(selection(), 'down') },
    { id: 'bring-front', label: 'Bring to front', group: 'Arrange', keys: [{ key: '}', shift: true }], enabled: hasLayer, run: () => doc().reorderLayers(selection(), 'top') },
    { id: 'send-back', label: 'Send to back', group: 'Arrange', keys: [{ key: '{', shift: true }], enabled: hasLayer, run: () => doc().reorderLayers(selection(), 'bottom') },
    ...ALIGN_ACTIONS.map(({ id, edge, label, keywords }): Action => ({ id, label, group: 'Arrange', keywords, enabled: hasUnlockedLayer, run: () => alignSelection(edge) })),
    { id: 'distribute-horizontal', label: 'Distribute horizontally', group: 'Arrange', keywords: 'space evenly spacing', enabled: () => unitCount() >= 3, run: () => distributeSelection('horizontal') },
    { id: 'distribute-vertical', label: 'Distribute vertically', group: 'Arrange', keywords: 'space evenly spacing', enabled: () => unitCount() >= 3, run: () => distributeSelection('vertical') },

    // Slide
    { id: 'add-slide', label: 'Add slide', group: 'Slide', keys: [{ key: 'n', shift: true }], run: () => doc().addSlide(currentSlideId()) },
    { id: 'duplicate-slide', label: 'Duplicate slide', group: 'Slide', run: () => { const id = currentSlideId(); if (id) doc().duplicateSlide(id); } },
    { id: 'delete-slide', label: 'Delete slide', group: 'Slide', enabled: () => doc().doc.slideOrder.length > 1, run: () => { const id = currentSlideId(); if (id) doc().deleteSlide(id); } },
    { id: 'prev-slide', label: 'Previous slide', group: 'Slide', keys: [{ key: 'PageUp' }], enabled: () => slideIndex() > 0, run: () => focusSlideAt(slideIndex() - 1) },
    { id: 'next-slide', label: 'Next slide', group: 'Slide', keys: [{ key: 'PageDown' }], enabled: () => slideIndex() < doc().doc.slideOrder.length - 1, run: () => focusSlideAt(slideIndex() + 1) },
    { id: 'move-slide-left', label: 'Move slide left', group: 'Slide', enabled: () => slideIndex() > 0, run: () => doc().moveSlide(slideIndex(), slideIndex() - 1) },
    { id: 'move-slide-right', label: 'Move slide right', group: 'Slide', enabled: () => slideIndex() < doc().doc.slideOrder.length - 1, run: () => doc().moveSlide(slideIndex(), slideIndex() + 1) },
    {
      id: 'background-all',
      label: 'Use this background on all slides',
      group: 'Slide',
      enabled: () => doc().doc.slideOrder.length > 1,
      run: () => { const id = currentSlideId(); if (id) doc().setBackgroundForAllSlides(doc().doc.slides[id].background); },
    },

    // View
    { id: 'preview', label: 'Preview on a phone', group: 'View', keys: [{ key: 'p', shift: false }], keywords: 'instagram feed swipe profile grid present play', run: () => useEditorView.getState().setPreviewOpen(true) },
    { id: 'palette', label: 'Command palette', group: 'View', keys: [{ key: 'k', mod: true, global: true }], hidden: true, run: () => session().setOverlay('palette') },
    { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'View', keys: [{ key: '?' }], keywords: 'help keys hotkeys', run: () => session().setOverlay('shortcuts') },
    { id: 'wide-mode', label: 'Wide view', group: 'View', keys: [{ key: 'w', shift: false }], keywords: 'strip panorama whole carousel overview seamless', run: () => useEditorView.getState().setWideMode(!useEditorView.getState().wideMode) },
    { id: 'zoom-in', label: 'Zoom in', group: 'View', keys: [{ key: '=' }, { key: '+' }], run: () => zoomTo(session().zoom * 1.25) },
    { id: 'zoom-out', label: 'Zoom out', group: 'View', keys: [{ key: '-' }], run: () => zoomTo(session().zoom / 1.25) },
    { id: 'zoom-fit', label: 'Zoom to fit', group: 'View', keys: [{ code: 'Digit1', shift: true }], run: () => zoomTo(session().fitZoom) },
    { id: 'zoom-100', label: 'Zoom to 100%', group: 'View', keys: [{ code: 'Digit0', shift: true }], run: () => zoomTo(1) },
    { id: 'toggle-panel', label: 'Show / hide side panel', group: 'View', keys: [{ key: '\\', mod: true }], run: () => session().setLeftPanelOpen(!session().leftPanelOpen) },

    // Panels
    { id: 'panel-grids', label: 'Open Grids', group: 'Panels', keywords: 'templates layout', run: () => session().setLeftPanel('templates') },
    { id: 'panel-media', label: 'Open Media', group: 'Panels', keywords: 'photos library', run: () => session().setLeftPanel('photos') },
    { id: 'panel-text', label: 'Open Text styles', group: 'Panels', run: () => session().setLeftPanel('text') },
    { id: 'panel-shapes', label: 'Open Shapes', group: 'Panels', run: () => session().setLeftPanel('shapes') },
    { id: 'panel-background', label: 'Open Background', group: 'Panels', keywords: 'color colour gradient', run: () => session().setLeftPanel('background') },

    // Export
    { id: 'export-carousel', label: 'Export carousel', group: 'Export', keys: [{ key: 'e', mod: true, shift: true, global: true }], keywords: 'zip instagram download', enabled: () => !useExport.getState().exporting, run: () => void useExport.getState().exportCarousel() },
    { id: 'export-slide', label: 'Download slide as PNG', group: 'Export', keywords: 'image save', enabled: () => !useExport.getState().exporting, run: () => void useExport.getState().exportCurrentSlide() },

    // Project
    {
      id: 'go-projects',
      label: 'Go to projects',
      group: 'Project',
      keywords: 'home close',
      run: () => void doc().closeProject().catch(() => toast('Could not save your project. Please retry before leaving.', 'error')),
    },
    {
      id: 'new-project',
      label: 'New project',
      group: 'Project',
      run: () => {
        if (confirm('Start a new project? Current work is autosaved separately.')) void doc().newProject().catch(() => toast('Could not save your project. Please retry.', 'error'));
      },
    },
    {
      id: 'rename-project',
      label: 'Rename project',
      group: 'Project',
      run: () => { const input = document.querySelector<HTMLInputElement>('input[data-project-name]'); input?.focus(); input?.select(); },
    },
  ];

  for (const template of GRID_TEMPLATES) {
    actions.push({
      id: `grid-${template.id}`,
      label: `Apply grid · ${template.name}`,
      group: 'Grids',
      keywords: 'layout template collage',
      run: () => doc().applyGrid(template, 0),
    });
  }
  return actions;
}

const isTextField = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Handles one keydown for the editor. Returns true when the event was consumed.
 * Arrow keys nudge the selected layer (Shift = 10px) or, with nothing selected, change slides.
 */
export function handleEditorKey(e: KeyboardEvent, actions: Action[] = buildActions()): boolean {
  const inField = isTextField(e.target);
  if (!inField && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.startsWith('Arrow')) {
    const step = e.shiftKey ? 10 : 1;
    if (hasLayer()) {
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!delta) return false;
      e.preventDefault();
      nudgeSelected(delta[0], delta[1]);
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      focusSlideAt(slideIndex() + (e.key === 'ArrowLeft' ? -1 : 1));
      return true;
    }
    return false;
  }
  for (const action of actions) {
    const binding = action.keys?.find((b) => matchesBinding(b, e));
    if (!binding) continue;
    if (inField && !binding.global) return false;
    e.preventDefault();
    if (action.enabled && !action.enabled()) return true;
    action.run();
    return true;
  }
  return false;
}
