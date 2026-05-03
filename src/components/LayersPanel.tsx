import { useState, type CSSProperties } from 'react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  ChevronRight,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Lock,
  LockOpen,
  RotateCcw,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { useEditor, selectActiveSlide } from '@/store/editor';
import type { ImageLayer, Layer } from '@/types';

const layerIcon = (l: Layer) =>
  l.kind === 'image' ? ImageIcon : l.kind === 'text' ? Type : Square;

interface RowProps {
  layer: Layer;
  selected: boolean;
}

const FOCAL_POINTS = [
  { label: 'Top left', x: -0.5, y: -0.5 },
  { label: 'Top', x: 0, y: -0.5 },
  { label: 'Top right', x: 0.5, y: -0.5 },
  { label: 'Left', x: -0.5, y: 0 },
  { label: 'Center', x: 0, y: 0 },
  { label: 'Right', x: 0.5, y: 0 },
  { label: 'Bottom left', x: -0.5, y: 0.5 },
  { label: 'Bottom', x: 0, y: 0.5 },
  { label: 'Bottom right', x: 0.5, y: 0.5 },
];

function ImageLayerSettings({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const radiusMax = Math.max(1, Math.min(layer.width, layer.height) / 2);
  const radiusFillPct = `${Math.min(100, Math.max(0, (layer.cornerRadius / radiusMax) * 100))}%`;

  const patch = (next: Partial<ImageLayer>) => updateLayer(layer.id, next);
  const setFocalPoint = (x: number, y: number) => patch({ cropOffsetX: x, cropOffsetY: y });
  const activeFocalPoint = FOCAL_POINTS.find(
    (p) => Math.abs(p.x - layer.cropOffsetX) < 0.01 && Math.abs(p.y - layer.cropOffsetY) < 0.01,
  );

  return (
    <details
      className="group mx-2 mb-2 overflow-hidden rounded-xl border border-line bg-gradient-to-b from-bg-panel/95 to-bg-inset/90 text-xs shadow-sm ring-1 ring-white/[0.03]"
      onClick={(e) => e.stopPropagation()}
    >
      <summary className="flex cursor-pointer select-none list-none items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-bg-hover/80 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 ring-1 ring-accent/25">
          <ImageIcon size={16} strokeWidth={1.75} className="text-accent" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[11px] font-semibold tracking-tight text-ink">Photo</span>
        </span>
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-bg/80 text-ink-dim transition-colors group-open:border-accent/35 group-open:text-accent">
          <ChevronRight size={16} strokeWidth={2} className="transition-transform duration-200 group-open:rotate-90" />
        </span>
      </summary>

      <div className="space-y-3 border-t border-line bg-bg/30 px-3 py-3">
        <div className="rounded-lg border border-line/90 bg-bg-inset/50 px-3 py-2.5 shadow-inner">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Corner radius</span>
            <span className="rounded-md bg-bg px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink ring-1 ring-line">
              {Math.round(layer.cornerRadius)} px
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={radiusMax}
            value={layer.cornerRadius}
            onChange={(e) => patch({ cornerRadius: Number(e.target.value) })}
            className="layer-radius-range"
            style={{ '--radius-fill': radiusFillPct } as CSSProperties}
            aria-valuetext={`${Math.round(layer.cornerRadius)} pixels`}
          />
        </div>

        <div className="rounded-lg border border-line/90 bg-bg-inset/50 px-3 py-2.5 shadow-inner">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              <Crosshair size={12} className="text-accent/90" strokeWidth={2} aria-hidden />
              Focal point
            </span>
            <span className="max-w-[52%] truncate text-right text-[10px] font-medium text-ink-dim">
              {activeFocalPoint?.label ?? 'Custom'}
            </span>
          </div>
          <div
            className="grid grid-cols-3 gap-1 rounded-md border border-line/80 bg-bg-rail/40 p-1.5"
            role="group"
            aria-label="Focal point"
          >
            {FOCAL_POINTS.map((point) => {
              const active =
                Math.abs(point.x - layer.cropOffsetX) < 0.01 &&
                Math.abs(point.y - layer.cropOffsetY) < 0.01;
              return (
                <button
                  key={point.label}
                  type="button"
                  title={point.label}
                  aria-label={point.label}
                  aria-pressed={active}
                  className={`flex aspect-square min-h-[30px] items-center justify-center rounded-md border text-ink-faint transition-all ${
                    active
                      ? 'border-accent bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgba(124,92,255,0.35)]'
                      : 'border-transparent bg-bg/60 hover:border-line hover:bg-bg-hover hover:text-ink-dim'
                  }`}
                  onClick={() => setFocalPoint(point.x, point.y)}
                >
                  <span
                    className={`rounded-full bg-current transition-transform ${active ? 'h-2 w-2' : 'h-1.5 w-1.5 opacity-70'}`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line/90 bg-bg/50 py-2 text-[11px] font-medium text-ink-dim transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-ink"
          onClick={() =>
            patch({
              cornerRadius: 0,
              cropOffsetX: 0,
              cropOffsetY: 0,
            })
          }
        >
          <RotateCcw size={13} strokeWidth={2} aria-hidden />
          Reset to defaults
        </button>
      </div>
    </details>
  );
}

function LayerRow({ layer, selected }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
  });
  const select = useEditor((s) => s.selectLayer);
  const toggleVisible = useEditor((s) => s.toggleVisible);
  const toggleLocked = useEditor((s) => s.toggleLocked);
  const del = useEditor((s) => s.deleteLayer);
  const dup = useEditor((s) => s.duplicateLayer);
  const rename = useEditor((s) => s.renameLayer);
  const [editing, setEditing] = useState(false);

  const Icon = layerIcon(layer);
  const visible = layer.visible;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const hoverActionsClass = `absolute right-16 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-bg-rail/95 px-0.5 shadow-lg ring-1 ring-line transition-opacity ${
    selected
      ? 'opacity-100 pointer-events-auto'
      : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
  }`;

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`group relative flex items-center gap-1 border-l-2 py-1 pl-1 pr-2 text-xs cursor-default ${
          selected ? 'bg-bg-inset border-accent' : 'border-transparent hover:bg-bg-inset'
        }`}
        onClick={() => select(layer.id)}
      >
        <button {...attributes} {...listeners} className="text-ink-faint hover:text-ink touch-none cursor-grab active:cursor-grabbing">
          <GripVertical size={14} />
        </button>
        <Icon size={13} className={visible ? 'text-ink-dim' : 'text-ink-faint'} />
        {editing ? (
          <input
            autoFocus
            defaultValue={layer.name}
            onBlur={(e) => {
              rename(layer.id, e.target.value || layer.name);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="min-w-0 flex-1 bg-bg-inset px-1 outline-none text-ink"
          />
        ) : (
          <button
            className={`min-w-0 flex-1 pr-1 text-left truncate ${visible ? 'text-ink' : 'text-ink-faint line-through'}`}
            onDoubleClick={() => setEditing(true)}
            title={layer.name}
          >
            {layer.name}
          </button>
        )}

        <div className={hoverActionsClass}>
          <button
            className="icon-btn"
            title="Duplicate"
            onClick={(e) => {
              e.stopPropagation();
              dup(layer.id);
            }}
          >
            <Copy size={12} />
          </button>
          <button
            className="icon-btn"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              del(layer.id);
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>

        <div className="relative z-20 ml-auto mr-0.5 flex shrink-0 items-center gap-0.5">
        <button
          className="icon-btn"
          title={layer.locked ? 'Unlock' : 'Lock'}
          onClick={(e) => {
            e.stopPropagation();
            toggleLocked(layer.id);
          }}
        >
          {layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
        <button
          className="icon-btn"
          title={visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation();
            toggleVisible(layer.id);
          }}
        >
          {visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        </div>
      </div>
      {selected && layer.kind === 'image' && <ImageLayerSettings layer={layer} />}
    </div>
  );
}

export function LayersPanel() {
  const slide = useEditor(selectActiveSlide);
  const selectedId = useEditor((s) => s.selectedLayerId);
  const updateLayers = useEditor((s) => s.updateLayer);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (!slide) return null;

  const reversed = [...slide.layers].reverse();

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = reversed.findIndex((l) => l.id === e.active.id);
    const newIdx = reversed.findIndex((l) => l.id === e.over!.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reorderedReversed = [...reversed];
    const [m] = reorderedReversed.splice(oldIdx, 1);
    reorderedReversed.splice(newIdx, 0, m);
    const newOrder = reorderedReversed.reverse();
    // map order to direct mutation: we update by re-assigning slide.layers via a noop patch trick.
    // Simpler: dispatch through editor's internal reorder by computing required swaps.
    const editor = (window as unknown as { __editor: typeof useEditor }).__editor;
    void editor; // not used - keep typing happy
    void updateLayers;
    useEditor.setState((state) => {
      const nextDoc = JSON.parse(JSON.stringify(state.doc));
      const sl = nextDoc.slides.find((x: { id: string }) => x.id === slide.id);
      if (sl) sl.layers = newOrder;
      return {
        doc: { ...nextDoc, updatedAt: Date.now() },
        past: [...state.past, state.doc].slice(-80),
        future: [],
      };
    });
  };

  return (
    <div className="text-ink">
      <div className="panel-section flex justify-between items-center">
        <span>Layers</span>
        <span className="text-ink-faint normal-case tracking-normal">{slide.layers.length}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={reversed.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col">
            {reversed.length === 0 && (
              <div className="px-3 py-6 text-xs text-ink-faint text-center">
                Empty slide. Add photos, text, or shapes from the left rail.
              </div>
            )}
            {reversed.map((l) => (
              <LayerRow
                key={l.id}
                layer={l}
                selected={l.id === selectedId}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
