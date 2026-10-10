import { useMemo, type ComponentType } from 'react';
import {
  BringToFront,
  Copy,
  Group as GroupIcon,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Lock,
  LockOpen,
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

function BarButton({ Icon, label, onClick, disabled, tone = 'default' }: { Icon: Icon; label: string; onClick: () => void; disabled?: boolean; tone?: 'default' | 'accent' | 'danger' }) {
  const color = { default: 'text-ink-dim active:text-ink', accent: 'text-accent', danger: 'text-red-300 active:bg-red-500/15' }[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      className={`flex h-14 min-w-[56px] shrink-0 touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-medium leading-none transition-colors duration-150 active:bg-bg-hover disabled:pointer-events-none disabled:opacity-35 ${color}`}
      onClick={() => {
        haptic();
        onClick();
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
  if (!ids.length) return null;

  const layers = ids.map((id) => doc.layers[id]);
  const { label, Icon } = describeSelection(doc, layers, ids);
  const allLocked = layers.every((l) => l.locked);
  const photo = layers.length === 1 && layers[0].kind === 'image' ? layers[0] : null;
  const { atFront, atBack } = stackEdges(doc, ids);
  const can = (id: string) => !!actions.get(id) && (actions.get(id)?.enabled?.() ?? true);
  const run = (id: string) => {
    if (can(id)) actions.get(id)?.run();
  };

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="shrink-0 border-t border-line bg-bg-panel"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      <div className="flex h-16 items-stretch">
        <div role="status" aria-label={`Selected: ${label}`} className="flex w-[64px] shrink-0 flex-col items-center justify-center gap-1 border-r border-line">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon size={15} strokeWidth={1.9} aria-hidden />
          </span>
          <span className="max-w-full truncate px-1 text-[11px] font-medium leading-none text-ink">{label}</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <BarButton Icon={SlidersHorizontal} label="Edit" tone="accent" onClick={onEdit} />
          {photo && <BarButton Icon={photo.assetId ? Replace : ImagePlus} label={photo.assetId ? 'Replace' : 'Add photo'} onClick={onReplacePhoto} />}
          <BarButton Icon={Copy} label="Duplicate" disabled={!can('duplicate-layer')} onClick={() => run('duplicate-layer')} />
          <BarButton Icon={BringToFront} label="Forward" disabled={!can('bring-forward') || atFront} onClick={() => run('bring-forward')} />
          <BarButton Icon={SendToBack} label="Backward" disabled={!can('send-backward') || atBack} onClick={() => run('send-backward')} />
          <BarButton Icon={allLocked ? LockOpen : Lock} label={allLocked ? 'Unlock' : 'Lock'} disabled={!can('toggle-lock')} onClick={() => run('toggle-lock')} />
          {can('group') && <BarButton Icon={GroupIcon} label="Group" onClick={() => run('group')} />}
          {can('ungroup') && <BarButton Icon={UngroupIcon} label="Ungroup" onClick={() => run('ungroup')} />}
          <BarButton Icon={Trash2} label="Delete" tone="danger" disabled={!can('delete-layer')} onClick={() => run('delete-layer')} />
        </div>

        <div className="flex shrink-0 items-center border-l border-line px-3">
          <button
            type="button"
            className="h-10 touch-manipulation select-none rounded-full bg-accent px-5 text-[15px] font-semibold text-white transition-colors duration-150 active:bg-accent-hover"
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
