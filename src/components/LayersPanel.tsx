import { useMemo, useState } from 'react';
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
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Layers,
  Lock,
  LockOpen,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { useEditor } from '@/store/editor';
import { materializeSlide } from '@/core/document/selectors';
import { useEditorSession } from '@/editor/sessionStore';
import type { Layer } from '@/types';
import { EmptyState } from './ui';
import { useContextMenu } from './Menu';
import { layerMenu } from '@/app/menus';
import { useAssets } from '@/store/assets';

const layerIcon = (l: Layer) =>
  l.kind === 'image' ? ImageIcon : l.kind === 'text' ? Type : Square;

function LayerRow({ layer, selected, onEdit }: { layer: Layer; selected: boolean; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
  });
  const select = useEditorSession((s) => s.selectLayer);
  const toggleVisible = useEditor((s) => s.toggleVisible);
  const toggleLocked = useEditor((s) => s.toggleLocked);
  const del = useEditor((s) => s.deleteLayer);
  const dup = useEditor((s) => s.duplicateLayer);
  const rename = useEditor((s) => s.renameLayer);
  const [editing, setEditing] = useState(false);
  const thumb = useAssets((s) => (layer.kind === 'image' && layer.assetId ? s.thumbs[layer.assetId] : undefined));
  const openMenu = useContextMenu((s) => s.open);

  const Icon = layerIcon(layer);
  const visible = layer.visible;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  const hoverOnly = selected
    ? ''
    : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100';

  return (
    <div ref={setNodeRef} style={style} className="px-1.5">
      <div
        className={`group relative flex h-8 items-center gap-1.5 rounded-md pl-0.5 pr-0.5 text-xs transition-colors ${
          selected ? 'bg-accent-soft' : 'hover:bg-bg-hover'
        } ${isDragging ? 'bg-bg-overlay shadow-lift' : ''}`}
        onClick={() => select(layer.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          select(layer.id);
          openMenu(e.clientX, e.clientY, layerMenu({ onRename: () => setEditing(true) }), 'Layer actions');
        }}
      >
        <button
          {...attributes}
          {...listeners}
          className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-ink-faint hover:text-ink active:cursor-grabbing"
          aria-label={`Reorder ${layer.name}`}
        >
          <GripVertical size={13} />
        </button>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded ${
            selected ? 'bg-accent text-white' : 'bg-bg-inset text-ink-dim'
          } ${thumb ? 'ring-1 ring-inset ring-white/10' : ''}`}
        >
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} /> : <Icon size={13} aria-hidden />}
        </span>
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
            className="input h-6 min-w-0 flex-1 px-1.5"
            aria-label="Layer name"
          />
        ) : (
          <button
            className={`min-w-0 flex-1 truncate pl-1 text-left ${visible ? 'text-ink' : 'text-ink-faint line-through'} ${selected ? 'font-medium' : ''}`}
            onDoubleClick={() => setEditing(true)}
            title={`${layer.name} — double-click to rename`}
          >
            {layer.name}
          </button>
        )}

        <div className={`flex shrink-0 items-center transition-opacity ${hoverOnly}`}>
          <button
            className="icon-btn !h-6 !w-6"
            title="Duplicate"
            onClick={(e) => {
              e.stopPropagation();
              dup(layer.id);
            }}
          >
            <Copy size={13} />
          </button>
          <button
            className="icon-btn !h-6 !w-6 danger-hover"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              del(layer.id);
            }}
          >
            <Trash2 size={13} />
          </button>
          {selected && (
            <button
              className="icon-btn !h-6 !w-6"
              title="Edit properties"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <SlidersHorizontal size={13} />
            </button>
          )}
        </div>
        <button
          className={`icon-btn !h-6 !w-6 ${layer.locked ? '!text-ink' : `${hoverOnly} text-ink-faint`}`}
          title={layer.locked ? 'Unlock' : 'Lock'}
          onClick={(e) => {
            e.stopPropagation();
            toggleLocked(layer.id);
          }}
        >
          {layer.locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
        <button
          className={`icon-btn !h-6 !w-6 ${visible ? '' : '!text-ink'}`}
          title={visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation();
            toggleVisible(layer.id);
          }}
        >
          {visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      </div>
    </div>
  );
}

export function LayersPanel({ onEditLayer }: { onEditLayer: () => void }) {
  const doc = useEditor((s) => s.doc);
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const slide = useMemo(() => materializeSlide(doc, selectedSlideId || doc.slideOrder[0]), [doc, selectedSlideId]);
  const selectedId = useEditorSession((s) => s.selectedLayerId);
  const setLayerOrder = useEditor((s) => s.setLayerOrder);
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
    setLayerOrder(slide.id, newOrder.map((layer) => layer.id));
  };

  return (
    <div className="py-2 text-ink">
      <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-faint">Top of the list is in front. Drag to reorder, double-click to rename, right-click for more.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={reversed.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-0.5">
            {reversed.length === 0 && (
              <EmptyState icon={<Layers size={22} aria-hidden />} title="Empty slide">
                Add photos, text, or shapes from the tools on the left.
              </EmptyState>
            )}
            {reversed.map((l) => (
              <LayerRow key={l.id} layer={l} selected={l.id === selectedId} onEdit={onEditLayer} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
