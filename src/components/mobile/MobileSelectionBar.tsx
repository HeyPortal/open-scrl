import { useEffect, useMemo, type ComponentType } from 'react';
import {
  BringToFront,
  Copy,
  Group as GroupIcon,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Lock,
  LockOpen,
  MoreHorizontal,
  Replace,
  SendToBack,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
  Ungroup as UngroupIcon,
} from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { buildActions } from '@/app/actions';
import { useContextMenu, type MenuEntry } from '@/components/Menu';
import { selectionSlideId, selectionUnits } from '@/core/document/selectors';
import type { Layer, ProjectDocumentV2 } from '@/types';

type Icon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;

/** Light tap feedback where the browser supports it (Android Chrome; iOS Safari ignores it). */
function haptic() {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Some browsers throw when vibration is blocked; the tap still works.
  }
}

/** Names the selection for the chip at the left of the bar: "Photo", "Text", "Shape", "Group", "3 layers". */
function describeSelection(doc: ProjectDocumentV2, layers: Layer[], ids: string[]): { label: string; Icon: Icon } {
  if (layers.length === 1) {
    const kind = layers[0].kind;
    return { label: { image: 'Photo', text: 'Text', shape: 'Shape' }[kind], Icon: { image: ImageIcon, text: Type, shape: Square }[kind] };
  }
  const oneGroup = selectionUnits(doc, ids).length === 1 && layers.every((l) => l.groupId && l.groupId === layers[0].groupId);
  return oneGroup ? { label: 'Group', Icon: GroupIcon } : { label: `${layers.length} layers`, Icon: Layers };
}

/** True when the selected layers already fill the top (or bottom) of their slide's stack. */
function stackEdges(doc: ProjectDocumentV2, ids: string[]) {
  const slideId = selectionSlideId(doc, ids);
  const order = slideId ? doc.slides[slideId]?.layerOrder ?? [] : [];
  const picked = new Set(ids);
  const count = ids.length;
  return {
    atFront: order.slice(order.length - count).every((id) => picked.has(id)),
    atBack: order.slice(0, count).every((id) => picked.has(id)),
  };
}

const MORE_LABEL = 'More actions';

type BarButtonProps = { Icon: Icon; label: string; onClick: (button: HTMLButtonElement) => void; disabled?: boolean; tone?: 'default' | 'accent' | 'danger'; ariaLabel?: string; expanded?: boolean };

function BarButton({ Icon, label, onClick, disabled, tone = 'default', ariaLabel, expanded }: BarButtonProps) {
  const color = { default: 'text-ink-dim active:text-ink', accent: 'text-accent', danger: 'text-danger active:bg-red-500/15' }[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-haspopup={expanded === undefined ? undefined : 'menu'}
      aria-expanded={expanded}
      className={`mobile-selbar-btn flex h-14 min-w-0 flex-1 touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[11px] font-medium leading-none transition-colors duration-150 active:bg-bg-hover disabled:pointer-events-none disabled:opacity-35 ${expanded ? 'bg-bg-hover text-ink' : color}`}
      onClick={(event) => {
        haptic();
        onClick(event.currentTarget);
      }}
    >
      <Icon size={22} strokeWidth={1.8} aria-hidden />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/** Contextual actions for the selected layer(s); replaces the dock while something is selected. */
export function MobileSelectionBar({ onEdit, onReplacePhoto }: { onEdit: () => void; onReplacePhoto: () => void }) {
  const doc = useEditor((s) => s.doc);
  const selectedIds = useEditorSession((s) => s.selectedLayerIds);
  // Actions read the stores when they run, so one lookup table serves every render.
  const actions = useMemo(() => new Map(buildActions().map((action) => [action.id, action])), []);

  const ids = selectedIds.filter((id) => !!doc.layers[id]);
  const hasSelection = ids.length > 0;
  const moreOpen = useContextMenu((s) => s.menu?.label === MORE_LABEL);
  const selectionKey = ids.join(',');
  // The menu is app-wide and built when it opens; drop it when the selection it was opened for changes.
  useEffect(() => {
    const { menu, close } = useContextMenu.getState();
    if (menu?.label === MORE_LABEL) close();
  }, [selectionKey]);
  useEffect(() => () => {
    const { menu, close } = useContextMenu.getState();
    if (menu?.label === MORE_LABEL) close();
  }, []);
  if (!hasSelection) return null;

  const layers = ids.map((id) => doc.layers[id]);
  const { label, Icon } = describeSelection(doc, layers, ids);
  const allLocked = layers.every((l) => l.locked);
  const photo = layers.length === 1 && layers[0].kind === 'image' ? layers[0] : null;
  const { atFront, atBack } = stackEdges(doc, ids);
  const can = (id: string) => !!actions.get(id) && (actions.get(id)?.enabled?.() ?? true);
  const run = (id: string) => {
    if (can(id)) actions.get(id)?.run();
  };

  // Four slots fit a 360 px row beside the kind chip and Done. Edit and Delete stay one tap away with
  // Duplicate (Replace for a photo, which is swapped more often than copied); the rest sit under More.
  const entry = (label: string, Icon: Icon, id: string, extra: Partial<Extract<MenuEntry, { label: string }>> = {}): MenuEntry => ({
    label,
    icon: <Icon size={16} strokeWidth={1.8} aria-hidden />,
    disabled: !can(id) || extra.disabled,
    onSelect: () => {
      haptic();
      run(id);
    },
  });
  const structure = [
    ...(photo ? [entry('Duplicate', Copy, 'duplicate-layer')] : []),
    ...(can('group') ? [entry('Group', GroupIcon, 'group')] : []),
    ...(can('ungroup') ? [entry('Ungroup', UngroupIcon, 'ungroup')] : []),
  ];
  const moreItems: MenuEntry[] = [
    ...structure,
    ...(structure.length ? [{ separator: true } as const] : []),
    entry('Forward', BringToFront, 'bring-forward', { disabled: atFront }),
    entry('Backward', SendToBack, 'send-backward', { disabled: atBack }),
    entry(allLocked ? 'Unlock' : 'Lock', allLocked ? LockOpen : Lock, 'toggle-lock'),
  ];
  const toggleMore = (button: HTMLElement) => {
    const menu = useContextMenu.getState();
    if (moreOpen) return menu.close();
    const rect = button.getBoundingClientRect();
    // Opens upward: the bar sits at the bottom edge, so the menu's own flip puts it just above the button.
    // On a phone held sideways the bar is a left rail, so the menu opens to its right instead.
    const rail = !!window.matchMedia?.('(orientation: landscape) and (max-height: 500px)').matches;
    if (rail) menu.open(rect.right + 8, rect.bottom, moreItems, MORE_LABEL, button);
    else menu.open(Math.max(8, rect.right - 232), rect.top - 8, moreItems, MORE_LABEL, button);
  };

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="mobile-selbar shrink-0"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mobile-selbar-row flex h-16 items-stretch">
        <div role="status" aria-label={`Selected: ${label}`} className="mobile-selbar-chip flex w-14 shrink-0 flex-col items-center justify-center gap-1 border-r border-line">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon size={15} strokeWidth={1.9} aria-hidden />
          </span>
          <span className="max-w-full truncate px-1 text-[11px] font-medium leading-none text-ink">{label}</span>
        </div>

        <div className="mobile-selbar-actions flex min-w-0 flex-1 items-center gap-0.5 px-1">
          <BarButton Icon={SlidersHorizontal} label="Edit" tone="accent" onClick={onEdit} />
          {photo ? (
            <BarButton Icon={photo.assetId ? Replace : ImagePlus} label={photo.assetId ? 'Replace' : 'Add photo'} onClick={onReplacePhoto} />
          ) : (
            <BarButton Icon={Copy} label="Duplicate" disabled={!can('duplicate-layer')} onClick={() => run('duplicate-layer')} />
          )}
          <BarButton Icon={Trash2} label="Delete" tone="danger" disabled={!can('delete-layer')} onClick={() => run('delete-layer')} />
          <BarButton Icon={MoreHorizontal} label="More" ariaLabel={MORE_LABEL} expanded={moreOpen} onClick={toggleMore} />
        </div>

        <div className="mobile-selbar-done flex shrink-0 items-center border-l border-line px-2">
          <button
            type="button"
            className="h-10 touch-manipulation select-none rounded-full bg-accent px-4 text-[15px] font-semibold text-accent-ink transition-colors duration-150 active:bg-accent-hover"
            onClick={() => {
              haptic();
              useEditorSession.getState().selectLayer(null);
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
