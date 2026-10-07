import { useMemo, useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Eye,
  EyeOff,
  Group as GroupIcon,
  Layers,
  Lock,
  LockOpen,
  Trash2,
  Ungroup as UngroupIcon,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useEditor } from '@/store/editor';
import { enteredGroupId } from '@/editor/selectionActions';
import { selectionUnits } from '@/core/document/selectors';
import { rotatedBounds, unionBounds, type AlignEdge } from '@/core/document/geometry';
import { alignSelection, buildActions, distributeSelection, formatBinding, isMac } from '@/app/actions';
import type { Layer } from '@/types';
import { NumberField, Section, Slider } from '../ui';
import { Segmented } from './controls';
import { PhotoSwapSection } from './PhotoSwapSection';
import { useEditGesture } from './useLayerGesture';

export const ALIGN_BUTTONS: { edge: AlignEdge; label: string; Icon: typeof AlignStartVertical }[] = [
  { edge: 'left', label: 'Align left', Icon: AlignStartVertical },
  { edge: 'centerX', label: 'Align centers horizontally', Icon: AlignCenterVertical },
  { edge: 'right', label: 'Align right', Icon: AlignEndVertical },
  { edge: 'top', label: 'Align top', Icon: AlignStartHorizontal },
  { edge: 'centerY', label: 'Align centers vertically', Icon: AlignCenterHorizontal },
  { edge: 'bottom', label: 'Align bottom', Icon: AlignEndHorizontal },
];

const shortcut = (id: string) => {
  const keys = buildActions().find((a) => a.id === id)?.keys?.[0];
  return keys ? formatBinding(keys).join(isMac ? '' : '+') : '';
};

function IconButton({ title, onClick, active, danger, children }: { title: string; onClick: () => void; active?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`icon-btn ${active ? 'icon-btn-active' : ''} ${danger ? 'danger-hover' : ''}`} title={title} aria-label={title} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

/** Design tab for a selection of several layers, or one group. */
export function SelectionInspector({ ids }: { ids: string[] }) {
  const layers = useEditor(useShallow((s) => ids.map((id) => s.doc.layers[id]).filter(Boolean) as Layer[]));
  const doc = useEditor((s) => s.doc);
  const updateLayers = useEditor((s) => s.updateLayers);
  const moveLayers = useEditor((s) => s.moveLayers);
  const resizeLayers = useEditor((s) => s.resizeLayers);
  const reorderLayers = useEditor((s) => s.reorderLayers);
  const duplicateLayers = useEditor((s) => s.duplicateLayers);
  const deleteLayers = useEditor((s) => s.deleteLayers);
  const groupLayers = useEditor((s) => s.groupLayers);
  const ungroupLayers = useEditor((s) => s.ungroupLayers);
  const [alignTo, setAlignTo] = useState<'selection' | 'slide'>('selection');
  const moveGesture = useEditGesture('Move layers');
  const sizeGesture = useEditGesture('Resize layers');
  const opacityGesture = useEditGesture('Change opacity');

  const units = useMemo(() => selectionUnits(doc, ids), [doc, ids]);
  const bounds = useMemo(() => unionBounds(layers.map((l) => rotatedBounds(l))), [layers]);
  if (!layers.length || !bounds) return null;

  const groupIds = new Set(layers.map((l) => l.groupId).filter(Boolean));
  const isOneGroup = units.length === 1 && groupIds.size === 1;
  const anyGrouped = groupIds.size > 0;
  const canGroup = !isOneGroup || !!enteredGroupId(doc, ids);
  const allLocked = layers.every((l) => l.locked);
  const allVisible = layers.every((l) => l.visible);
  const opacity = layers[0].opacity;
  const mixedOpacity = layers.some((l) => Math.abs(l.opacity - opacity) > 0.001);
  const target = units.length < 2 ? 'slide' : alignTo;
  const set = (patch: Partial<Layer>) => updateLayers(layers.map((l) => ({ id: l.id, patch })));
  const kinds = new Set(layers.map((l) => l.kind));
  const noun = kinds.size === 1 ? { image: 'photos', text: 'text layers', shape: 'shapes' }[layers[0].kind] : 'layers';
  const title = isOneGroup ? `Group of ${layers.length}` : `${layers.length} ${noun}`;

  return (
    <div className="text-ink">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          {isOneGroup ? <GroupIcon size={15} strokeWidth={1.9} aria-hidden /> : <Layers size={15} strokeWidth={1.9} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate px-0.5 text-xs font-semibold text-ink">{title}</p>
          <p className="truncate px-0.5 text-[11px] tabular-nums text-ink-faint">{Math.round(bounds.width)} × {Math.round(bounds.height)}{allLocked ? ' · Locked' : ''}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton title={allLocked ? 'Unlock all' : 'Lock all'} active={allLocked} onClick={() => set({ locked: !allLocked })}>
            {allLocked ? <Lock size={14} /> : <LockOpen size={14} />}
          </IconButton>
          <IconButton title={allVisible ? 'Hide all' : 'Show all'} active={!allVisible} onClick={() => set({ visible: !allVisible })}>
            {allVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          </IconButton>
          <IconButton title={`Duplicate (${shortcut('duplicate-layer')})`} onClick={() => duplicateLayers(ids)}>
            <Copy size={14} />
          </IconButton>
          <IconButton title="Delete (Del)" danger onClick={() => deleteLayers(ids)}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      {ids.length === 2 && <PhotoSwapSection ids={ids} />}

      <Section title="Group">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className="btn btn-secondary btn-sm" disabled={!canGroup} onClick={() => groupLayers(ids)} title={`Group (${shortcut('group')})`}>
            <GroupIcon size={13} className="shrink-0" aria-hidden /> Group
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!anyGrouped} onClick={() => ungroupLayers(ids)} title={`Ungroup (${shortcut('ungroup')})`}>
            <UngroupIcon size={13} className="shrink-0" aria-hidden /> Ungroup
          </button>
        </div>
        <p className="text-[11px] leading-snug text-ink-faint">
          {isOneGroup
            ? 'Moves, scales and stacks as one. Double-click a layer on the canvas to edit it on its own.'
            : 'Group these to move, scale and stack them as one.'}
        </p>
      </Section>

      <Section title="Align" action={units.length >= 2 ? (
        <div className="w-[136px]">
          <Segmented label="Align to" value={alignTo} onChange={setAlignTo} options={[{ value: 'selection', label: 'Selection', title: 'Line up with each other' }, { value: 'slide', label: 'Slide', title: 'Line up with the slide' }]} />
        </div>
      ) : <span className="text-[11px] text-ink-faint">To slide</span>}>
        <div className="segmented grid-cols-6" role="group" aria-label={target === 'slide' ? 'Align to slide' : 'Align to each other'}>
          {ALIGN_BUTTONS.map(({ edge, label, Icon }) => (
            <button key={edge} type="button" className="segmented-btn" title={label} aria-label={label} disabled={allLocked} onClick={() => alignSelection(edge, target)}>
              <Icon size={15} aria-hidden />
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className="btn btn-secondary btn-sm" disabled={units.length < 3} onClick={() => distributeSelection('horizontal')} title="Even horizontal spacing">
            <AlignHorizontalSpaceAround size={13} className="shrink-0" aria-hidden /> Space across
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={units.length < 3} onClick={() => distributeSelection('vertical')} title="Even vertical spacing">
            <AlignVerticalSpaceAround size={13} className="shrink-0" aria-hidden /> Space down
          </button>
        </div>
        {units.length < 3 && <p className="text-[11px] leading-snug text-ink-faint">Select three or more to space them evenly.</p>}
      </Section>

      <Section title="Position & size">
        <div className="grid grid-cols-2 gap-2">
          <NumberField prefix="X" ariaLabel="X position" value={bounds.x} disabled={allLocked} gesture={moveGesture} onChange={(x) => moveLayers(ids, x - bounds.x, 0)} />
          <NumberField prefix="Y" ariaLabel="Y position" value={bounds.y} disabled={allLocked} gesture={moveGesture} onChange={(y) => moveLayers(ids, 0, y - bounds.y)} />
          <NumberField prefix="W" ariaLabel="Width" value={bounds.width} min={1} disabled={allLocked} gesture={sizeGesture} onChange={(width) => resizeLayers(ids, bounds, { ...bounds, width })} />
          <NumberField prefix="H" ariaLabel="Height" value={bounds.height} min={1} disabled={allLocked} gesture={sizeGesture} onChange={(height) => resizeLayers(ids, bounds, { ...bounds, height })} />
        </div>
        <Slider
          label="Opacity"
          display={mixedOpacity ? 'Mixed' : `${Math.round(opacity * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(value) => set({ opacity: value })}
          gesture={opacityGesture}
          valueText={mixedOpacity ? 'Mixed' : `${Math.round(opacity * 100)} percent`}
        />
      </Section>

      <Section title="Stack">
        <div className="segmented grid-cols-4" role="group" aria-label="Stack position">
          {([
            { title: 'Send to back', direction: 'bottom', Icon: ChevronsDown },
            { title: 'Send backward', direction: 'down', Icon: ChevronDown },
            { title: 'Bring forward', direction: 'up', Icon: ChevronUp },
            { title: 'Bring to front', direction: 'top', Icon: ChevronsUp },
          ] as const).map(({ title: label, direction, Icon }) => (
            <button key={direction} type="button" className="segmented-btn" title={label} aria-label={label} onClick={() => reorderLayers(ids, direction)}>
              <Icon size={15} aria-hidden />
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
