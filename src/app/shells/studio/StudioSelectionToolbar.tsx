import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { Copy, Ellipsis, ImagePlus, Lock, Trash2 } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { editorActivity } from '@/editor/activity';
import { findLayerSlideId } from '@/core/document/selectors';
import { rotatedBounds, unionBounds } from '@/core/document/geometry';
import { DropdownMenu } from '@/components/Menu';
import { layerMenu } from '@/app/menus';
import { runStudioAction } from './StudioControls';

/** The stage's public scroller plus document world coordinates keep seam selections anchored. */
export function StudioSelectionToolbar({ frameRef, width, height }: { frameRef: RefObject<HTMLDivElement | null>; width: number; height: number }) {
  const doc = useEditor((s) => s.doc);
  const ids = useEditorSession((s) => s.selectedLayerIds);
  const zoom = useEditorSession((s) => s.zoom);
  const focus = useEditorSession((s) => s.slideFocusRequest);
  const activity = useSyncExternalStore(editorActivity.subscribe, editorActivity.getSnapshot);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const scroller = frameRef.current?.querySelector('[data-testid="canvas-scroll"]');
    if (!scroller) return;
    const sync = () => setScroll({ left: scroller.scrollLeft, top: scroller.scrollTop });
    sync();
    scroller.addEventListener('scroll', sync, { passive: true });
    const frame = requestAnimationFrame(sync);
    return () => { cancelAnimationFrame(frame); scroller.removeEventListener('scroll', sync); };
  }, [frameRef, zoom, width, height, focus, doc.slideOrder]);
  const layers = ids.map((id) => doc.layers[id]).filter((layer) => layer?.visible);
  const bounds = unionBounds(layers.map((layer) => {
    const slide = findLayerSlideId(doc, layer.id);
    return rotatedBounds({ ...layer, x: layer.x + Math.max(0, doc.slideOrder.indexOf(slide ?? '')) * doc.format.width });
  }));
  if (!bounds || activity || width < 240) return null;
  const originX = Math.max(32, Math.round((width - doc.slideOrder.length * doc.format.width * zoom) / 2));
  const originY = Math.max(32, Math.round((height - doc.format.height * zoom) / 2));
  const left = originX - scroll.left + bounds.x * zoom;
  const top = originY - scroll.top + bounds.y * zoom;
  if (left + bounds.width * zoom < 0 || left > width || top + bounds.height * zoom < 0 || top > height) return null;
  const x = Math.max(120, Math.min(width - 120, left + bounds.width * zoom / 2));
  // Leave the Transformer's rotation handle (50px above the layer) reachable.
  const above = top - 104;
  const below = top + bounds.height * zoom + 16;
  const y = above >= 8 ? above : below;
  if (y + 44 > height - 8) return null;
  const photo = layers.length === 1 && layers[0].kind === 'image';
  return <div className="studio-selection-toolbar studio-glass" role="toolbar" aria-label="Selection actions" style={{ left: x, top: y }}>
    {photo && <><button className="icon-btn" aria-label="Replace photo…" title="Replace photo…" onClick={() => useEditorSession.getState().setLeftPanel('photos')}><ImagePlus size={16} aria-hidden /></button><span className="studio-divider" aria-hidden /></>}
    <button className="icon-btn" aria-label="Duplicate" title="Duplicate" onClick={() => runStudioAction('duplicate-layer')}><Copy size={15} aria-hidden /></button>
    <button className="icon-btn" aria-label="Lock / unlock" title="Lock / unlock" onClick={() => runStudioAction('toggle-lock')}><Lock size={15} aria-hidden /></button>
    <button className="icon-btn danger-hover" aria-label="Delete" title="Delete" onClick={() => runStudioAction('delete-layer')}><Trash2 size={15} aria-hidden /></button>
    <DropdownMenu label="Layer actions" title="Layer actions" className="icon-btn" items={layerMenu}><Ellipsis size={17} aria-hidden /></DropdownMenu>
  </div>;
}
