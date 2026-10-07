import type { MenuEntry } from '@/components/Menu';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { currentSelection } from '@/editor/selectionActions';
import { buildActions, formatBinding, type Action } from './actions';

const SEP = { separator: true } as const;

function fromActions(ids: (string | '-')[], overrides: Record<string, Partial<Extract<MenuEntry, { label: string }>>> = {}): MenuEntry[] {
  const byId = new Map(buildActions().map((a) => [a.id, a] as [string, Action]));
  return ids.flatMap((id): MenuEntry[] => {
    if (id === '-') return [SEP];
    const action = byId.get(id);
    if (!action) return [];
    return [{
      label: action.label,
      shortcut: action.keys?.[0] ? formatBinding(action.keys[0]) : undefined,
      disabled: action.enabled ? !action.enabled() : false,
      onSelect: action.run,
      ...overrides[id],
    }];
  });
}

/** Menu for the selection (canvas right-click or layer row). */
export function layerMenu(options: { onRename?: () => void } = {}): MenuEntry[] {
  const d = useEditor.getState().doc;
  const layers = currentSelection(d).map((id) => d.layers[id]);
  if (!layers.length) return slideMenu();
  const many = layers.length > 1;
  const allLocked = layers.every((l) => l.locked);
  const allVisible = layers.every((l) => l.visible);
  const noun = many ? `${layers.length} layers` : 'layer';
  const items = fromActions(
    ['duplicate-layer', 'delete-layer', '-', 'group', 'ungroup', '-', 'bring-front', 'bring-forward', 'send-backward', 'send-back',
      ...(many ? ['-', 'align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom', 'distribute-horizontal', 'distribute-vertical'] : []),
      '-', 'toggle-lock', 'toggle-visible'],
    {
      'duplicate-layer': { label: `Duplicate ${noun}` },
      'delete-layer': { label: `Delete ${noun}`, danger: true },
      'toggle-lock': { label: `${allLocked ? 'Unlock' : 'Lock'} ${noun}` },
      'toggle-visible': { label: `${allVisible ? 'Hide' : 'Show'} ${noun}` },
    },
  ).filter((item) => !('label' in item && item.disabled && (item.label === 'Group' || item.label === 'Ungroup')));
  // Hiding unavailable group items can leave two separators in a row.
  const tidy = items.filter((item, i) => !('separator' in item && (i === 0 || 'separator' in items[i - 1])));
  const layer = layers[0];
  if (!many && options.onRename) tidy.push({ label: 'Rename', onSelect: options.onRename });
  if (!many && layer.kind === 'image') tidy.push(SEP, { label: layer.assetId ? 'Replace photo…' : 'Choose photo…', onSelect: () => useEditorSession.getState().setLeftPanel('photos') });
  return tidy;
}

/** Menu for the current slide (empty canvas area or filmstrip thumbnail). */
export function slideMenu(): MenuEntry[] {
  return fromActions(
    ['add-slide', 'duplicate-slide', 'delete-slide', '-', 'move-slide-left', 'move-slide-right', '-', 'add-text', 'add-rect', 'import-media', '-', 'background-all', 'export-slide'],
    { 'add-slide': { label: 'Add slide after' }, 'delete-slide': { danger: true } },
  );
}
