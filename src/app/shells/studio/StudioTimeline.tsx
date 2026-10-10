import { useMemo } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { SlidePreviewImage } from '@/components/SlidePreviewCanvas';
import { DropdownMenu, useContextMenu } from '@/components/Menu';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useAssets } from '@/store/assets';
import { slideScene, type SlideScene } from '@/render/preview';
import { slideHasAnimatedMedia } from '@/lib/media';
import { slideMenu } from '@/app/menus';
import { StudioViewControls, runStudioAction } from './StudioControls';

function StudioSlide({ id, index, scene, animated, format }: { id: string; index: number; scene: SlideScene; animated: boolean; format: { width: number; height: number } }) {
  const active = useEditorSession((s) => s.selectedSlideId === id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const select = () => useEditorSession.getState().focusSlide(id);
  const height = 58;
  const width = height * format.width / format.height;
  return <div ref={setNodeRef} className={`studio-slide ${isDragging ? 'studio-slide-dragging' : ''}`} style={{ transform: CSS.Translate.toString(transform), transition }}>
    <button {...attributes} {...listeners} className={`studio-slide-preview ${active ? 'studio-slide-active' : ''}`} style={{ width: width + 4, height: height + 4 }} title={`Slide ${index + 1}`} aria-label={`Slide ${index + 1}`} aria-current={active ? 'true' : undefined} onClick={select} onContextMenu={(e) => { e.preventDefault(); select(); useContextMenu.getState().open(e.clientX, e.clientY, slideMenu(), 'Slide actions'); }}>
      <SlidePreviewImage scene={scene} format={format} width={width} height={height} delay={150} />
      {animated && <span className="studio-video-badge">video</span>}
    </button>
    <span className={active ? 'text-ink' : 'text-ink-faint'}>{String(index + 1).padStart(2, '0')}</span>
  </div>;
}

export function StudioTimeline() {
  const doc = useEditor((s) => s.doc);
  const assets = useAssets((s) => s.assets);
  const selected = useEditorSession((s) => s.selectedSlideId);
  const index = Math.max(0, doc.slideOrder.indexOf(selected));
  const scenes = useMemo(() => doc.slideOrder.map((id) => ({ id, scene: slideScene(doc, id), animated: slideHasAnimatedMedia(doc, id, assets) })), [doc, assets]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = doc.slideOrder.indexOf(String(active.id));
    const to = doc.slideOrder.indexOf(String(over.id));
    if (from >= 0 && to >= 0) useEditor.getState().moveSlide(from, to);
  };
  return <section className="studio-timeline studio-glass" aria-label="Slide timeline">
    <div className="studio-timeline-heading">
      <DropdownMenu label="Slide actions" className="studio-timeline-label" items={slideMenu}><span className="studio-timeline-title">Carousel<ChevronDown size={11} aria-hidden /></span><span className="text-ink-faint">{doc.slideOrder.length} {doc.slideOrder.length === 1 ? 'slide' : 'slides'}</span></DropdownMenu>
      <div className="studio-timeline-actions">
        <button className="icon-btn" title="Move slide left" aria-label="Move slide left" disabled={index === 0} onClick={() => runStudioAction('move-slide-left')}><ChevronLeft size={16} aria-hidden /></button>
        <button className="icon-btn" title="Move slide right" aria-label="Move slide right" disabled={index === doc.slideOrder.length - 1} onClick={() => runStudioAction('move-slide-right')}><ChevronRight size={16} aria-hidden /></button>
        <button className="icon-btn" title="Duplicate slide" aria-label="Duplicate slide" onClick={() => runStudioAction('duplicate-slide')}><Copy size={14} aria-hidden /></button>
        <button className="icon-btn danger-hover" title="Delete slide" aria-label="Delete slide" disabled={doc.slideOrder.length <= 1} onClick={() => runStudioAction('delete-slide')}><Trash2 size={14} aria-hidden /></button>
      </div>
    </div>
    <div className="studio-timeline-slides scrollbar-thin">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={doc.slideOrder} strategy={horizontalListSortingStrategy}>
        {scenes.map(({ id, scene, animated }, i) => <StudioSlide key={id} id={id} index={i} scene={scene} animated={animated} format={doc.format} />)}
      </SortableContext></DndContext>
      <button className="studio-add-slide" title="Add slide" aria-label="Add slide" onClick={() => runStudioAction('add-slide')}><Plus size={20} aria-hidden /></button>
    </div>
    <StudioViewControls />
  </section>;
}
