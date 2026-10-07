import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useSortable, SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Group as GroupIcon,
  Image as ImageIcon,
  Layers,
  Lock,
  LockOpen,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react';
import { useEditor } from '@/store/editor';
import { command } from '@/core/document/commands';
import { materializeSlide } from '@/core/document/selectors';
import { useEditorSession } from '@/editor/sessionStore';
import { isMac } from '@/app/actions';
import type { Layer } from '@/types';
import { EmptyState } from './ui';
import { useContextMenu } from './Menu';
import { layerMenu } from '@/app/menus';
import { useAssets } from '@/store/assets';

const layerIcon = (l: Layer) =>
  l.kind === 'image' ? ImageIcon : l.kind === 'text' ? Type : Square;

type Row =
  | { type: 'group'; key: string; groupId: string; members: Layer[] }
  | { type: 'layer'; key: string; layer: Layer; groupId: string | null };

/** Front-to-back rows. Consecutive members of a group get a header row; collapsed groups hide their members. */
function buildRows(topFirst: Layer[], collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < topFirst.length;) {
    const group = topFirst[i].groupId;
    let j = i + 1;
    while (group && j < topFirst.length && topFirst[j].groupId === group) j++;
    if (!group || j - i < 2) {
      rows.push({ type: 'layer', key: topFirst[i].id, layer: topFirst[i], groupId: null });
      i += 1;
      continue;
    }
    const members = topFirst.slice(i, j);
    rows.push({ type: 'group', key: `group:${group}:${i}`, groupId: group, members });
    if (!collapsed.has(group)) for (const layer of members) rows.push({ type: 'layer', key: layer.id, layer, groupId: group });
    i = j;
  }
  return rows;
}

const rowIds = (row: Row) => (row.type === 'group' ? row.members.map((l) => l.id) : [row.layer.id]);

/** Additive click: ⌘ on a Mac, Ctrl elsewhere. */
const isToggle = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);

function RowShell({ id, selected, partly, depth, onClick, onContextMenu, children, label }: {
  id: string;
  selected: boolean;
  partly?: boolean;
  depth: number;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  children: (handle: ReactNode, hoverOnly: string) => ReactNode;
  label: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined };
  const hoverOnly = 'hidden group-hover:flex group-focus-within:flex';
  const handle = (
    <button
      {...attributes}
      {...listeners}
      className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-ink-faint hover:text-ink active:cursor-grabbing"
      aria-label={`Reorder ${label}`}
    >
      <GripVertical size={13} />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className="px-1.5">
      <div
        className={`group relative flex h-8 items-center gap-1.5 rounded-md pl-0.5 pr-0.5 text-xs transition-colors ${
          selected ? 'bg-accent-soft' : partly ? 'bg-accent/[0.07] hover:bg-bg-hover' : 'hover:bg-bg-hover'
        } ${isDragging ? 'bg-bg-overlay shadow-lift' : ''}`}
        style={{ paddingLeft: depth ? 14 : undefined }}
        onClick={onClick}
        onContextMenu={onContextMenu}
        aria-selected={selected}
        role="option"
      >
        {depth > 0 && <span className="pointer-events-none absolute bottom-1 left-[13px] top-1 w-px bg-line-strong" aria-hidden />}
        {children(handle, hoverOnly)}
      </div>
    </div>
  );
}

function ToggleButtons({ locked, visible, hoverOnly, onLock, onVisible }: { locked: boolean; visible: boolean; hoverOnly: string; onLock: () => void; onVisible: () => void }) {
  return (
    <>
      <button
        className={`icon-btn !h-6 !w-6 ${locked ? '!text-ink' : `${hoverOnly} text-ink-faint`}`}
        title={locked ? 'Unlock' : 'Lock'}
        onClick={(e) => { e.stopPropagation(); onLock(); }}
      >
        {locked ? <Lock size={13} /> : <LockOpen size={13} />}
      </button>
      <button
        className={`icon-btn !h-6 !w-6 ${visible ? '' : '!text-ink'}`}
        title={visible ? 'Hide' : 'Show'}
        onClick={(e) => { e.stopPropagation(); onVisible(); }}
      >
        {visible ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
    </>
  );
}

function LayerRow({ row, selected, partly, onSelect, onEdit }: {
  row: Extract<Row, { type: 'layer' }>;
  selected: boolean;
  partly: boolean;
  onSelect: (e: React.MouseEvent, row: Row) => void;
  onEdit: () => void;
}) {
  const layer = row.layer;
  const toggleVisible = useEditor((s) => s.toggleVisible);
  const toggleLocked = useEditor((s) => s.toggleLocked);
  const deleteLayers = useEditor((s) => s.deleteLayers);
  const duplicateLayers = useEditor((s) => s.duplicateLayers);
  const rename = useEditor((s) => s.renameLayer);
  const [editing, setEditing] = useState(false);
  const thumb = useAssets((s) => (layer.kind === 'image' && layer.assetId ? s.thumbs[layer.assetId] : undefined));
  const openMenu = useContextMenu((s) => s.open);
  const Icon = layerIcon(layer);

  return (
    <RowShell
      id={row.key}
      label={layer.name}
      selected={selected}
      partly={partly}
      depth={row.groupId ? 1 : 0}
      onClick={(e) => onSelect(e, row)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selected) onSelect(e, row);
        openMenu(e.clientX, e.clientY, layerMenu({ onRename: () => setEditing(true) }), 'Layer actions');
      }}
    >
      {(handle, hoverOnly) => (
        <>
          {handle}
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
              onClick={(e) => e.stopPropagation()}
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
              className={`min-w-0 flex-1 truncate pl-1 text-left ${layer.visible ? 'text-ink' : 'text-ink-faint line-through'} ${selected ? 'font-medium' : ''}`}
              onDoubleClick={() => setEditing(true)}
              title={`${layer.name} — double-click to rename`}
            >
              {layer.name}
            </button>
          )}

          <div className={`shrink-0 items-center ${hoverOnly}`}>
            <button className="icon-btn !h-6 !w-6" title="Duplicate" onClick={(e) => { e.stopPropagation(); duplicateLayers([layer.id]); }}>
              <Copy size={13} />
            </button>
            <button className="icon-btn !h-6 !w-6 danger-hover" title="Delete" onClick={(e) => { e.stopPropagation(); deleteLayers([layer.id]); }}>
              <Trash2 size={13} />
            </button>
            {selected && (
              <button className="icon-btn !h-6 !w-6" title="Edit properties" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                <SlidersHorizontal size={13} />
              </button>
            )}
          </div>
          <ToggleButtons locked={layer.locked} visible={layer.visible} hoverOnly={hoverOnly} onLock={() => toggleLocked(layer.id)} onVisible={() => toggleVisible(layer.id)} />
        </>
      )}
    </RowShell>
  );
}

function GroupRow({ row, selected, partly, collapsed, onToggleCollapsed, onSelect }: {
  row: Extract<Row, { type: 'group' }>;
  selected: boolean;
  partly: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (e: React.MouseEvent, row: Row) => void;
}) {
  const updateLayers = useEditor((s) => s.updateLayers);
  const ungroupLayers = useEditor((s) => s.ungroupLayers);
  const deleteLayers = useEditor((s) => s.deleteLayers);
  const openMenu = useContextMenu((s) => s.open);
  const ids = row.members.map((l) => l.id);
  const locked = row.members.every((l) => l.locked);
  const visible = row.members.some((l) => l.visible);
  const setAll = (patch: Partial<Layer>) => updateLayers(ids.map((id) => ({ id, patch })));

  return (
    <RowShell
      id={row.key}
      label="group"
      selected={selected}
      partly={partly}
      depth={0}
      onClick={(e) => onSelect(e, row)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selected) onSelect(e, row);
        openMenu(e.clientX, e.clientY, layerMenu(), 'Group actions');
      }}
    >
      {(handle, hoverOnly) => (
        <>
          {handle}
          <button
            className="-ml-1 flex h-6 w-4 shrink-0 items-center justify-center text-ink-faint hover:text-ink"
            aria-label={collapsed ? 'Expand group' : 'Collapse group'}
            aria-expanded={!collapsed}
            onClick={(e) => { e.stopPropagation(); onToggleCollapsed(); }}
          >
            <ChevronRight size={12} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} aria-hidden />
          </button>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${selected ? 'bg-accent text-white' : 'bg-bg-inset text-ink-dim'}`}>
            <GroupIcon size={13} aria-hidden />
          </span>
          <span className={`min-w-0 flex-1 truncate pl-1 ${visible ? 'text-ink' : 'text-ink-faint line-through'} ${selected ? 'font-medium' : ''}`}>
            Group <span className="tabular-nums text-ink-faint">· {row.members.length}</span>
          </span>
          <div className={`shrink-0 items-center ${hoverOnly}`}>
            <button className="icon-btn !h-6 !w-6" title="Ungroup" onClick={(e) => { e.stopPropagation(); ungroupLayers(ids); }}>
              <Ungroup size={13} />
            </button>
            <button className="icon-btn !h-6 !w-6 danger-hover" title="Delete group" onClick={(e) => { e.stopPropagation(); deleteLayers(ids); }}>
              <Trash2 size={13} />
            </button>
          </div>
          <ToggleButtons locked={locked} visible={visible} hoverOnly={hoverOnly} onLock={() => setAll({ locked: !locked })} onVisible={() => setAll({ visible: !visible })} />
        </>
      )}
    </RowShell>
  );
}

export function LayersPanel({ onEditLayer }: { onEditLayer: () => void }) {
  const doc = useEditor((s) => s.doc);
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const slide = useMemo(() => materializeSlide(doc, selectedSlideId || doc.slideOrder[0]), [doc, selectedSlideId]);
  const selectedIds = useEditorSession((s) => s.selectedLayerIds);
  const selectLayers = useEditorSession((s) => s.selectLayers);
  const execute = useEditor((s) => s.execute);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // A dragged group header folds its members away until the drop.
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);

  const topFirst = useMemo(() => (slide ? [...slide.layers].reverse() : []), [slide]);
  const folded = useMemo(() => (draggingGroup ? new Set([...collapsed, draggingGroup]) : collapsed), [collapsed, draggingGroup]);
  const rows = useMemo(() => buildRows(topFirst, folded), [folded, topFirst]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  if (!slide) return null;

  const onSelect = (e: React.MouseEvent, row: Row) => {
    const ids = rowIds(row);
    const primary = ids[0];
    if (e.shiftKey && anchor.current) {
      // Range over the visible list, from the last clicked row to this one.
      const order = rows.flatMap((r) => (r.type === 'group' && !folded.has(r.groupId) ? [] : rowIds(r)));
      const a = order.indexOf(anchor.current), b = order.indexOf(primary);
      if (a >= 0 && b >= 0) {
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        selectLayers([...new Set([...(isToggle(e) ? selectedIds : []), ...range])], primary);
        return;
      }
    }
    anchor.current = primary;
    if (isToggle(e)) {
      const on = ids.every((id) => selected.has(id));
      selectLayers(on ? selectedIds.filter((id) => !ids.includes(id)) : [...selectedIds, ...ids], on ? undefined : primary);
      return;
    }
    selectLayers(ids, primary);
  };

  const commitOrder = (topFirstIds: string[], groupPatch?: { id: string; groupId: string | null }) => {
    const order = [...topFirstIds].reverse();
    if (order.length !== slide.layers.length) return;
    execute(command('Reorder layers', (d) => {
      d.slides[slide.id].layerOrder = order;
      if (groupPatch) {
        const layer = d.layers[groupPatch.id];
        if (groupPatch.groupId) layer.groupId = groupPatch.groupId;
        else delete layer.groupId;
      }
      // A group left with one member is no longer a group.
      const counts = new Map<string, number>();
      for (const id of order) { const g = d.layers[id].groupId; if (g) counts.set(g, (counts.get(g) ?? 0) + 1); }
      for (const id of order) { const g = d.layers[id].groupId; if (g && counts.get(g) === 1) delete d.layers[id].groupId; }
    }));
  };

  const onDragStart = (e: DragStartEvent) => {
    const row = rows.find((r) => r.key === e.active.id);
    if (row?.type === 'group') setDraggingGroup(row.groupId);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDraggingGroup(null);
    if (!e.over || e.active.id === e.over.id) return;
    const from = rows.findIndex((r) => r.key === e.active.id);
    const to = rows.findIndex((r) => r.key === e.over!.id);
    if (from < 0 || to < 0) return;
    const moving = rows[from];
    if (moving.type === 'group') {
      // Groups move as one block and never land inside another group.
      const blockOf = (index: number) => {
        let i = index;
        while (i > 0 && rows[i].type === 'layer' && (rows[i] as Extract<Row, { type: 'layer' }>).groupId) i--;
        return rows[i].key;
      };
      const blocks = rows.filter((r) => r.type === 'group' || !r.groupId);
      const target = blocks.findIndex((r) => r.key === blockOf(to));
      const source = blocks.findIndex((r) => r.key === moving.key);
      commitOrder(arrayMove(blocks, source, target).flatMap(rowIds));
      return;
    }
    const moved = arrayMove(rows, from, to);
    const at = moved.indexOf(moving);
    const above = moved[at - 1];
    const below = moved[at + 1];
    const groupAbove = above ? (above.type === 'group' ? (folded.has(above.groupId) ? null : above.groupId) : above.groupId) : null;
    const groupBelow = below?.type === 'layer' ? below.groupId : null;
    const current = moving.groupId;
    let next: string | null = null;
    if (groupAbove && (groupAbove === groupBelow || above?.type === 'group')) next = groupAbove;
    else if (current && (groupAbove === current || groupBelow === current)) next = current;
    const order = moved.flatMap((r) => (r.type === 'group' ? (folded.has(r.groupId) ? rowIds(r) : []) : [r.layer.id]));
    commitOrder(order, next !== current ? { id: moving.layer.id, groupId: next } : undefined);
  };

  const toggleCollapsed = (group: string) => setCollapsed((old) => {
    const next = new Set(old);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });

  return (
    <div className="py-2 text-ink">
      <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-faint">
        Top of the list is in front. Drag to reorder, {isMac ? '⌘' : 'Ctrl'}- or Shift-click to select several, right-click for more.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDraggingGroup(null)}>
        <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-0.5" role="listbox" aria-multiselectable aria-label="Layers">
            {rows.length === 0 && (
              <EmptyState icon={<Layers size={22} aria-hidden />} title="Empty slide">
                Add photos, text, or shapes from the tools on the left.
              </EmptyState>
            )}
            {rows.map((row) => {
              if (row.type === 'group') {
                const ids = rowIds(row);
                const all = ids.every((id) => selected.has(id));
                return <GroupRow key={row.key} row={row} selected={all} partly={!all && ids.some((id) => selected.has(id))} collapsed={folded.has(row.groupId)} onToggleCollapsed={() => toggleCollapsed(row.groupId)} onSelect={onSelect} />;
              }
              const groupSelected = !!row.groupId && topFirst.filter((l) => l.groupId === row.groupId).every((l) => selected.has(l.id));
              return <LayerRow key={row.key} row={row} selected={selected.has(row.layer.id) && !groupSelected} partly={groupSelected} onSelect={onSelect} onEdit={onEditLayer} />;
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
