import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import Konva from 'konva';
import { useEditor, selectActiveLayer } from '@/store/editor';
import type { Layer as DocLayer, Slide } from '@/types';
import { snapBox, type SnapGuide } from '@/lib/snap';
import { ImageNode } from './ImageNode';
import { TextNode } from './TextNode';
import { ShapeNode } from './ShapeNode';
import { TextEditor } from './TextEditor';

const SNAP_THRESHOLD_PX = 6;
const FIT_PADDING = 12;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const WHEEL_ZOOM_SENSITIVITY = 0.00115;
const SLIDE_RENDER_BUFFER = 1;

Konva.pixelRatio = 1;

export function Canvas({ width, height }: { width: number; height: number }) {
  const doc = useEditor((s) => s.doc);
  const selectedSlideId = useEditor((s) => s.selectedSlideId);
  const selectedId = useEditor((s) => s.selectedLayerId);
  const selectSlide = useEditor((s) => s.selectSlide);
  const selectLayer = useEditor((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const setLeftPanel = useEditor((s) => s.setLeftPanel);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const active = useEditor(selectActiveLayer);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const layerNodes = useRef<Map<string, Konva.Node>>(new Map());
  const zoomRef = useRef(zoom);
  const pendingZoomRef = useRef<number | null>(null);
  const zoomRafRef = useRef<number | null>(null);

  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [guideOffsetX, setGuideOffsetX] = useState(0);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [visibleSlideRange, setVisibleSlideRange] = useState({ start: 0, end: 0 });

  const fmt = doc.format;
  const deckWidth = Math.max(fmt.width, doc.slides.length * fmt.width);
  const stageWidth = Math.max(1, Math.ceil(deckWidth * zoom + FIT_PADDING * 2));
  const stageHeight = Math.max(1, Math.ceil(fmt.height * zoom + FIT_PADDING * 2));
  const renderedStageWidth = Math.max(width, stageWidth);
  const renderedStageHeight = Math.max(height, stageHeight);
  const contentOffset = {
    x: FIT_PADDING,
    y: Math.max(FIT_PADDING, Math.round((renderedStageHeight - fmt.height * zoom) / 2)),
  };

  const fitZoom = useMemo(() => {
    if (!width || !height) return 0.5;
    return Math.max(
      MIN_ZOOM,
      Math.min((width - FIT_PADDING * 2) / fmt.width, (height - FIT_PADDING * 2) / fmt.height),
    );
  }, [width, height, fmt.width, fmt.height]);

  const fitToScreen = useCallback(() => {
    setZoom(fitZoom);
  }, [fitZoom, setZoom]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(
    () => () => {
      if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current);
    },
    [],
  );

  // Fit synchronously after layout measurement so the stage does not keep an
  // old pan/zoom from a smaller viewport.
  useLayoutEffect(() => {
    fitToScreen();
  }, [fitToScreen]);

  const setExactZoom = (z: number) => {
    setZoom(z);
  };

  const getContentOffsetY = useCallback(
    (nextZoom: number) => {
      const nextStageHeight = Math.max(1, Math.ceil(fmt.height * nextZoom + FIT_PADDING * 2));
      const nextRenderedStageHeight = Math.max(height, nextStageHeight);
      return Math.max(FIT_PADDING, Math.round((nextRenderedStageHeight - fmt.height * nextZoom) / 2));
    },
    [fmt.height, height],
  );

  const setBufferedVisibleRange = useCallback(
    (start: number, end: number) => {
      const max = Math.max(0, doc.slides.length - 1);
      setVisibleSlideRange((prev) => {
        const next = {
          start: Math.max(0, Math.min(max, start - SLIDE_RENDER_BUFFER)),
          end: Math.max(0, Math.min(max, end + SLIDE_RENDER_BUFFER)),
        };
        return prev.start === next.start && prev.end === next.end ? prev : next;
      });
    },
    [doc.slides.length],
  );

  const updateVisibleSlidesFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const viewportLeft = Math.max(0, el.scrollLeft - contentOffset.x);
    const viewportRight = Math.max(0, el.scrollLeft + el.clientWidth - contentOffset.x);
    const slideWidth = Math.max(1, fmt.width * zoom);
    setBufferedVisibleRange(
      Math.floor(viewportLeft / slideWidth),
      Math.floor(viewportRight / slideWidth),
    );
  }, [contentOffset.x, fmt.width, setBufferedVisibleRange, zoom]);

  useEffect(() => {
    updateVisibleSlidesFromScroll();
  }, [updateVisibleSlidesFromScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => updateVisibleSlidesFromScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateVisibleSlidesFromScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = doc.slides.findIndex((s) => s.id === selectedSlideId);
    if (idx < 0) return;
    setBufferedVisibleRange(idx, idx);
    const pageLeft = FIT_PADDING + idx * fmt.width * zoom;
    const pageCenter = pageLeft + (fmt.width * zoom) / 2;
    el.scrollTo({
      left: Math.max(0, pageCenter - el.clientWidth / 2),
      top: 0,
      behavior: 'auto',
    });
  }, [doc.slides, fmt.width, selectedSlideId, setBufferedVisibleRange, zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable;
      if (inField) return;
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        fitToScreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitToScreen]);

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (!selectedId || active?.locked) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = layerNodes.current.get(selectedId);
    if (node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    } else {
      tr.nodes([]);
    }
  }, [active?.locked, doc.slides, selectedId]);

  const onWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      if (!e.evt.ctrlKey && !e.evt.metaKey) return;
      e.evt.preventDefault();
      const el = scrollRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const pointerX = e.evt.clientX - rect.left;
      const pointerY = e.evt.clientY - rect.top;
      const currentZoom = pendingZoomRef.current ?? zoomRef.current;
      const contentX = (el.scrollLeft + pointerX - contentOffset.x) / currentZoom;
      const contentY = (el.scrollTop + pointerY - contentOffset.y) / currentZoom;
      const delta =
        e.evt.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? e.evt.deltaY * 16
          : e.evt.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? e.evt.deltaY * height
            : e.evt.deltaY;
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, currentZoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)),
      );

      if (nextZoom === currentZoom) return;
      pendingZoomRef.current = nextZoom;

      if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current);
      zoomRafRef.current = requestAnimationFrame(() => {
        zoomRafRef.current = null;
        const scheduledZoom = pendingZoomRef.current;
        if (scheduledZoom === null) return;
        pendingZoomRef.current = null;
        zoomRef.current = scheduledZoom;
        setZoom(scheduledZoom);
        el.scrollTo({
          left: Math.max(0, FIT_PADDING + contentX * scheduledZoom - pointerX),
          top: Math.max(0, getContentOffsetY(scheduledZoom) + contentY * scheduledZoom - pointerY),
        });
      });
    },
    [contentOffset.x, contentOffset.y, getContentOffsetY, height, setZoom],
  );

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (e.target === e.target.getStage()) {
      selectLayer(null);
    }
  };

  const handleSelect =
    (slideId: string, layer: DocLayer) => (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      if (selectedSlideId !== slideId) selectSlide(slideId);
      if (selectedId !== layer.id) selectLayer(layer.id);
      if (layer.kind === 'image' && !layer.assetId) {
        setLeftPanel('photos');
      }
    };

  const handleDragMove =
    (slide: Slide, layer: DocLayer) => (e: Konva.KonvaEventObject<DragEvent>) => {
      if (layer.locked) return;
      if (!slide) return;
      if (layer.kind === 'image') return;
      const node = e.target;
      const w = layer.width;
      const h = layer.height;
      const cx = node.x();
      const cy = node.y();
      const tlx = cx - w / 2;
      const tly = cy - h / 2;
      const moving = { x: tlx, y: tly, width: w, height: h };
      const others = slide.layers.filter((l) => l.id !== layer.id);
      const result = snapBox(moving, others, fmt, SNAP_THRESHOLD_PX / zoom);
      node.x(result.x + w / 2);
      node.y(result.y + h / 2);
      setGuideOffsetX(doc.slides.findIndex((s) => s.id === slide.id) * fmt.width);
      setGuides(result.guides);
    };

  const handleDragEnd =
    (slide: Slide, layer: DocLayer) => (e: Konva.KonvaEventObject<DragEvent>) => {
      setGuides([]);
      setGuideOffsetX(0);
      if (layer.locked) return;
      const node = e.target;
      const w = layer.width;
      const h = layer.height;
      const moving = { x: node.x() - w / 2, y: node.y() - h / 2, width: w, height: h };
      const others = slide.layers.filter((l) => l.id !== layer.id);
      const result = snapBox(moving, others, fmt, SNAP_THRESHOLD_PX / zoom);
      updateLayer(layer.id, { x: result.x, y: result.y });
    };

  const getTransformedBox = (node: Konva.Node, layer: DocLayer) => {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const uniformScale =
      layer.kind === 'image'
        ? Math.max(Math.abs(scaleX), Math.abs(scaleY)) * (scaleX < 0 || scaleY < 0 ? -1 : 1)
        : null;
    const width = Math.max(8, layer.width * (uniformScale ?? scaleX));
    const height = Math.max(8, layer.height * (uniformScale ?? scaleY));
    return {
      x: node.x() - width / 2,
      y: node.y() - height / 2,
      width,
      height,
    };
  };

  const handleTransform =
    (slide: Slide, layer: DocLayer) => (e: Konva.KonvaEventObject<Event>) => {
      if (layer.locked) return;
      const node = e.target;
      const moving = getTransformedBox(node, layer);
      const others = slide.layers.filter((l) => l.id !== layer.id);
      const result = snapBox(moving, others, fmt, SNAP_THRESHOLD_PX / zoom);
      node.x(result.x + moving.width / 2);
      node.y(result.y + moving.height / 2);
      setGuideOffsetX(doc.slides.findIndex((s) => s.id === slide.id) * fmt.width);
      setGuides(result.guides);
    };

  const handleTransformEnd =
    (slide: Slide, layer: DocLayer) => (e: Konva.KonvaEventObject<Event>) => {
      if (layer.locked) return;
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const uniformScale =
        layer.kind === 'image'
          ? Math.max(Math.abs(scaleX), Math.abs(scaleY)) * (scaleX < 0 || scaleY < 0 ? -1 : 1)
          : null;
      const newWidth = Math.max(8, layer.width * (uniformScale ?? scaleX));
      const newHeight = Math.max(8, layer.height * (uniformScale ?? scaleY));
      node.scaleX(1);
      node.scaleY(1);
      const moving = {
        x: node.x() - newWidth / 2,
        y: node.y() - newHeight / 2,
        width: newWidth,
        height: newHeight,
      };
      const others = slide.layers.filter((l) => l.id !== layer.id);
      const result = snapBox(moving, others, fmt, SNAP_THRESHOLD_PX / zoom);
      updateLayer(layer.id, {
        x: result.x,
        y: result.y,
        width: newWidth,
        height: newHeight,
        rotation: node.rotation(),
      });
      setGuides([]);
      setGuideOffsetX(0);
    };

  const selectedSlideIndex = Math.max(
    0,
    doc.slides.findIndex((s) => s.id === selectedSlideId),
  );
  const textEditorSlideIndex = active
    ? Math.max(
        0,
        doc.slides.findIndex((s) => s.layers.some((layer) => layer.id === active.id)),
      )
    : selectedSlideIndex;
  const renderedSlides = useMemo(
    () =>
      doc.slides
        .map((slide, slideIndex) => ({ slide, slideIndex }))
        .filter(
          ({ slideIndex }) =>
            slideIndex >= visibleSlideRange.start && slideIndex <= visibleSlideRange.end,
        ),
    [doc.slides, visibleSlideRange.end, visibleSlideRange.start],
  );

  return (
    <div className="relative w-full h-full overflow-hidden bg-bg select-none">
      <div ref={scrollRef} className="w-full h-full overflow-auto scrollbar-thin">
        <Stage
          width={renderedStageWidth}
          height={renderedStageHeight}
          ref={stageRef}
          scaleX={zoom}
          scaleY={zoom}
          x={contentOffset.x}
          y={contentOffset.y}
          onWheel={onWheel}
          onMouseDown={onStageMouseDown}
          onTouchStart={onStageMouseDown}
        >
        <Layer listening={false}>
          <Rect
            x={0}
            y={0}
            width={deckWidth}
            height={fmt.height}
            fill="#000"
            opacity={0.18}
          />
        </Layer>
        <Layer>
          {doc.slides.map((slide, slideIndex) => {
            const pageX = slideIndex * fmt.width;
            const bgFill =
              slide.background.kind === 'solid' ? slide.background.color : '#ffffff';
            const activeSlide = slide.id === selectedSlideId;

            return (
              <Group key={slide.id} x={pageX}>
                <Rect
                  x={0}
                  y={0}
                  width={fmt.width}
                  height={fmt.height}
                  fill={bgFill}
                  listening
                  onMouseDown={() => {
                    selectSlide(slide.id);
                    selectLayer(null);
                  }}
                  onTouchStart={() => {
                    selectSlide(slide.id);
                    selectLayer(null);
                  }}
                />
                {slide.background.kind === 'gradient' && (
                  <Rect
                    x={0}
                    y={0}
                    width={fmt.width}
                    height={fmt.height}
                    fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                    fillLinearGradientEndPoint={{
                      x: fmt.width * Math.cos((slide.background.angle * Math.PI) / 180),
                      y: fmt.height * Math.sin((slide.background.angle * Math.PI) / 180),
                    }}
                    fillLinearGradientColorStops={[0, slide.background.from, 1, slide.background.to]}
                    listening
                    onMouseDown={() => {
                      selectSlide(slide.id);
                      selectLayer(null);
                    }}
                    onTouchStart={() => {
                      selectSlide(slide.id);
                      selectLayer(null);
                    }}
                  />
                )}
                <Rect
                  x={0}
                  y={0}
                  width={fmt.width}
                  height={fmt.height}
                  stroke={activeSlide ? '#7c5cff' : '#2b2b35'}
                  strokeWidth={activeSlide ? 3 / zoom : 1 / zoom}
                  listening={false}
                />
              </Group>
            );
          })}
          {renderedSlides.flatMap(({ slide, slideIndex }) =>
            slide.layers.map((layer) => {
            const onSelect = handleSelect(slide.id, layer);
            const onDragStart = () => {
              selectSlide(slide.id);
              selectLayer(layer.id);
            };
            const onDragMove = handleDragMove(slide, layer);
            const onDragEnd = handleDragEnd(slide, layer);
            const onTransform = handleTransform(slide, layer);
            const onTransformEnd = handleTransformEnd(slide, layer);
            const groupRef = (n: Konva.Node | null) => {
              if (n) layerNodes.current.set(layer.id, n);
              else layerNodes.current.delete(layer.id);
            };
            const pageX = slideIndex * fmt.width;
            if (layer.kind === 'image')
              return (
                <Group key={layer.id} x={pageX}>
                  <ImageNode
                  key={layer.id}
                  layer={layer}
                  selected={selectedId === layer.id}
                  onSelect={onSelect}
                  onDragStart={onDragStart}
                  onDragMove={onDragMove}
                  onDragEnd={onDragEnd}
                  onTransform={onTransform}
                  onTransformEnd={onTransformEnd}
                  groupRef={groupRef}
                />
                </Group>
              );
            if (layer.kind === 'shape')
              return (
                <Group key={layer.id} x={pageX}>
                  <ShapeNode
                  key={layer.id}
                  layer={layer}
                  onSelect={onSelect}
                  onDragStart={onDragStart}
                  onDragMove={onDragMove}
                  onDragEnd={onDragEnd}
                  onTransform={onTransform}
                  onTransformEnd={onTransformEnd}
                  groupRef={groupRef}
                />
                </Group>
              );
            return (
              <Group key={layer.id} x={pageX}>
                <TextNode
                key={layer.id}
                layer={layer}
                onSelect={onSelect}
                onDragStart={onDragStart}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onTransform={onTransform}
                onTransformEnd={onTransformEnd}
                onDblClick={() => setEditingTextId(layer.id)}
                nodeRef={groupRef}
              />
              </Group>
            );
            }),
          )}
          <Transformer
            ref={transformerRef}
            rotateEnabled
            anchorSize={10}
            anchorStroke="#7c5cff"
            anchorFill="#0b0b0f"
            anchorCornerRadius={2}
            borderStroke="#7c5cff"
            borderDash={[4, 4]}
            keepRatio={active?.kind === 'image'}
            enabledAnchors={
              active?.kind === 'image'
                ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                : [
                    'top-left',
                    'top-center',
                    'top-right',
                    'middle-left',
                    'middle-right',
                    'bottom-left',
                    'bottom-center',
                    'bottom-right',
                  ]
            }
            ignoreStroke
            boundBoxFunc={(oldB, newB) => (newB.width < 8 || newB.height < 8 ? oldB : newB)}
          />
        </Layer>
        <Layer listening={false}>
          {guides.map((g, i) =>
            g.orientation === 'v' ? (
              <Line
                key={i}
                points={[guideOffsetX + g.position, g.start, guideOffsetX + g.position, g.end]}
                stroke="#ff3b8a"
                strokeWidth={1 / zoom}
                dash={[6 / zoom, 4 / zoom]}
              />
            ) : (
              <Line
                key={i}
                points={[guideOffsetX + g.start, g.position, guideOffsetX + g.end, g.position]}
                stroke="#ff3b8a"
                strokeWidth={1 / zoom}
                dash={[6 / zoom, 4 / zoom]}
              />
            ),
          )}
        </Layer>
        </Stage>
      </div>
      {editingTextId && active?.kind === 'text' && stageRef.current && (
        <TextEditor
          layer={active}
          stage={stageRef.current}
          offsetX={textEditorSlideIndex * fmt.width}
          onClose={() => setEditingTextId(null)}
        />
      )}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-bg-rail/90 border border-line rounded-md px-1 py-1 text-[11px] text-ink-dim backdrop-blur">
        <button
          className="icon-btn !h-6 !w-6"
          onClick={() => setExactZoom(Math.max(MIN_ZOOM, zoom / 1.2))}
          title="Zoom out"
        >
          −
        </button>
        <button
          className="px-2 py-0.5 hover:bg-bg-hover rounded"
          onClick={fitToScreen}
          title="Fit to screen"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="icon-btn !h-6 !w-6"
          onClick={() => setExactZoom(Math.min(MAX_ZOOM, zoom * 1.2))}
          title="Zoom in"
        >
          +
        </button>
        <button className="ctrl-btn !py-1 !px-2" onClick={fitToScreen} title="Fit (F)">
          Fit
        </button>
        <button className="ctrl-btn !py-1 !px-2" onClick={() => setExactZoom(1)} title="100%">
          1:1
        </button>
      </div>
    </div>
  );
}
