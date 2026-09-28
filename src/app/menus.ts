import type { MenuEntry } from '@/components/Menu';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
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

/** Menu for the selected layer (canvas right-click or layer row). */
export function layerMenu(options: { onRename?: () => void } = {}): MenuEntry[] {
  const layerId = useEditorSession.getState().selectedLayerId;
  const layer = layerId ? useEditor.getState().doc.layers[layerId] : undefined;
  if (!layer) return slideMenu();
  const items = fromActions(
    ['duplicate-layer', 'delete-layer', '-', 'bring-front', 'bring-forward', 'send-backward', 'send-back', '-', 'toggle-lock', 'toggle-visible'],
    {
      'delete-layer': { danger: true },
      'toggle-lock': { label: layer.locked ? 'Unlock layer' : 'Lock layer' },
      'toggle-visible': { label: layer.visible ? 'Hide layer' : 'Show layer' },
    },
  );
  if (options.onRename) items.push({ label: 'Rename', onSelect: options.onRename });
  if (layer.kind === 'image') items.push(SEP, { label: layer.assetId ? 'Replace photo…' : 'Choose photo…', onSelect: () => useEditorSession.getState().setLeftPanel('photos') });
  return items;
}

/** Menu for the current slide (empty canvas area or filmstrip thumbnail). */
export function slideMenu(): MenuEntry[] {
  return fromActions(
    ['add-slide', 'duplicate-slide', 'delete-slide', '-', 'move-slide-left', 'move-slide-right', '-', 'add-text', 'add-rect', 'import-media', '-', 'background-all', 'export-slide'],
    { 'add-slide': { label: 'Add slide after' }, 'delete-slide': { danger: true } },
  );
}
