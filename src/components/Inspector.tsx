import { useMemo, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronsDown,
  ChevronsUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  Italic,
  Layers,
  Lock,
  LockOpen,
  MousePointerClick,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import type { ImageLayer, Layer, ShapeLayer, TextLayer } from '@/types';
import { GRADIENT_SWATCHES, SOLID_SWATCHES, backgroundCss, backgroundLabel, sameBackground } from '@/lib/palette';
import { RotationDial } from './RotationDial';
import { ColorField, LinkedSliders, NumberField, Section, Slider } from './ui';
import { useEditGesture, useLayerGesture } from './inspector/useLayerGesture';
import { Switch } from './inspector/controls';
import { PhotoSwapSection } from './inspector/PhotoSwapSection';
import { SlidePhotoActions } from './inspector/SlidePhotoActions';
import { ImageFrameSection, ShadowSection, TextFillSection, TextHighlightSection, TextOutlineSection } from './inspector/effects';
import { alignSelection, isMac } from '@/app/actions';
import { ALIGN_BUTTONS, SelectionInspector } from './inspector/SelectionInspector';
import { groupMemberIds } from '@/core/document/selectors';
import { getLiveGrid } from '@/core/document/grid';
import { linkedMax, maxGapFor, maxMargin } from '@/lib/grids';

const KIND_META = {
  image: { label: 'Photo', Icon: ImageIcon },
  text: { label: 'Text', Icon: Type },
  shape: { label: 'Shape', Icon: Square },
} as const;

function LayerHeader({ layer }: { layer: Layer }) {
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const deleteLayer = useEditor((s) => s.deleteLayer);
  const toggleLocked = useEditor((s) => s.toggleLocked);
  const toggleVisible = useEditor((s) => s.toggleVisible);
  const renameLayer = useEditor((s) => s.renameLayer);
  const [renaming, setRenaming] = useState(false);
  const { label, Icon } = KIND_META[layer.kind];
  const selectGroup = () => useEditorSession.getState().selectLayers(groupMemberIds(useEditor.getState().doc, layer.id), layer.id);
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent" title={label}>
        <Icon size={15} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            className="input h-6 px-1.5 font-semibold"
            defaultValue={layer.name}
            aria-label="Layer name"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => { renameLayer(layer.id, e.target.value.trim() || layer.name); setRenaming(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <button className="block max-w-full truncate rounded px-0.5 text-left text-xs font-semibold text-ink hover:bg-bg-hover" title="Rename layer" onClick={() => setRenaming(true)}>
            {layer.name}
          </button>
        )}
        <p className="truncate px-0.5 text-[11px] tabular-nums text-ink-faint">
          {Math.round(layer.width)} × {Math.round(layer.height)}{layer.locked ? ' · Locked' : ''}{layer.visible ? '' : ' · Hidden'}
          {layer.groupId && <> · <button type="button" className="font-medium text-accent hover:text-accent-hover" title="Select the whole group (Esc)" onClick={selectGroup}>In a group</button></>}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <button className={`icon-btn ${layer.locked ? 'icon-btn-active' : ''}`} title={layer.locked ? 'Unlock layer' : 'Lock layer'} aria-pressed={layer.locked} onClick={() => toggleLocked(layer.id)}>
          {layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
        </button>
        <button className={`icon-btn ${layer.visible ? '' : 'icon-btn-active'}`} title={layer.visible ? 'Hide layer' : 'Show layer'} aria-pressed={!layer.visible} onClick={() => toggleVisible(layer.id)}>
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button className="icon-btn" title={`Duplicate layer (${isMac ? '⌘' : 'Ctrl'} D)`} onClick={() => duplicateLayer(layer.id)}>
          <Copy size={14} />
        </button>
        <button className="icon-btn danger-hover" title="Delete layer (Del)" onClick={() => deleteLayer(layer.id)}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function ArrangeSection({ layer }: { layer: Layer }) {
  const reorderLayer = useEditor((s) => s.reorderLayer);
  const order = useEditor((s) => {
    const slideId = s.doc.slideOrder.find((id) => s.doc.slides[id].layerOrder.includes(layer.id));
    return slideId ? s.doc.slides[slideId].layerOrder : [];
  });
  const stackIndex = order.indexOf(layer.id);
  const stackCount = order.length;
  const atBack = stackIndex <= 0;
  const atFront = stackIndex >= stackCount - 1;
  const stack = [
    { title: 'Send to back', direction: 'bottom' as const, disabled: atBack, Icon: ChevronsDown },
    { title: 'Send backward', direction: 'down' as const, disabled: atBack, Icon: ChevronDown },
    { title: 'Bring forward', direction: 'up' as const, disabled: atFront, Icon: ChevronUp },
    { title: 'Bring to front', direction: 'top' as const, disabled: atFront, Icon: ChevronsUp },
  ];
  return (
    <Section title="Arrange" action={<span className="text-[11px] tabular-nums text-ink-faint">{stackIndex + 1} of {stackCount}</span>}>
      <div className="segmented grid-cols-4" role="group" aria-label="Layer position">
        {stack.map(({ title, direction, disabled, Icon }) => (
          <button key={title} type="button" className="segmented-btn" title={title} aria-label={title} disabled={disabled} onClick={() => reorderLayer(layer.id, direction)}>
            <Icon size={15} aria-hidden />
          </button>
        ))}
      </div>
      <div className="segmented grid-cols-6" role="group" aria-label="Align to slide">
        {ALIGN_BUTTONS.map(({ edge, label, Icon }) => (
          <button key={edge} type="button" className="segmented-btn" title={`${label} on the slide`} aria-label={`${label} on the slide`} disabled={layer.locked} onClick={() => alignSelection(edge, 'slide')}>
            <Icon size={15} aria-hidden />
          </button>
        ))}
      </div>
    </Section>
  );
}

function LayoutSection({ layer, onPatch }: { layer: Layer; onPatch: (patch: Partial<Layer>) => void }) {
  const locked = layer.locked;
  const opacityPct = Math.round(layer.opacity * 100);
  const opacityGesture = useLayerGesture(layer.id, 'Change opacity');
  const rotationGesture = useLayerGesture(layer.id, 'Rotate layer');
  const moveGesture = useLayerGesture(layer.id, 'Move layer');
  const sizeGesture = useLayerGesture(layer.id, 'Resize layer');

  return (
    <Section title="Position & size" action={locked ? <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint"><Lock size={11} aria-hidden />Locked</span> : undefined}>
      <div className="grid grid-cols-2 gap-2">
        <NumberField prefix="X" ariaLabel="X position" value={layer.x} onChange={(v) => onPatch({ x: v })} disabled={locked} gesture={moveGesture} />
        <NumberField prefix="Y" ariaLabel="Y position" value={layer.y} onChange={(v) => onPatch({ y: v })} disabled={locked} gesture={moveGesture} />
        <NumberField prefix="W" ariaLabel="Width" value={layer.width} min={1} onChange={(v) => onPatch({ width: v })} disabled={locked} gesture={sizeGesture} />
        <NumberField prefix="H" ariaLabel="Height" value={layer.height} min={1} onChange={(v) => onPatch({ height: v })} disabled={locked || (layer.kind === 'text' && !layer.autoFit)} gesture={sizeGesture} />
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <NumberField
            prefix={<RotateCcw size={11} className="-scale-x-100" aria-hidden />}
            ariaLabel="Rotation"
            suffix="°"
            value={Math.round(layer.rotation)}
            onChange={(v) => onPatch({ rotation: v })}
            disabled={locked}
            gesture={rotationGesture}
          />
        </div>
        <RotationDial
          compact
          size={32}
          value={layer.rotation}
          onChange={(v) => onPatch({ rotation: v })}
          disabled={locked}
          onInteractionStart={rotationGesture.begin}
          onInteractionEnd={(cancelled) => cancelled ? rotationGesture.cancel() : rotationGesture.end()}
        />
      </div>
      <Slider
        label="Opacity"
        display={`${opacityPct}%`}
        min={0}
        max={1}
        step={0.01}
        value={layer.opacity}
        onChange={(v) => onPatch({ opacity: v })}
        gesture={opacityGesture}
        valueText={`${opacityPct} percent`}
      />
    </Section>
  );
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

function ImageInspector({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const setLeftPanel = useEditorSession((s) => s.setLeftPanel);
  const patch = (next: Partial<ImageLayer>) => updateLayer(layer.id, next);
  const cropScale = Math.min(4, Math.max(1, layer.cropScale || 1));
  const cropGesture = useLayerGesture(layer.id, 'Change crop');
  const activeFocalPoint = FOCAL_POINTS.find(
    (p) => Math.abs(p.x - layer.cropOffsetX) < 0.01 && Math.abs(p.y - layer.cropOffsetY) < 0.01,
  );

  return (
    <>
      <Section
        title="Photo"
        action={
          <button className="text-xs font-medium text-accent hover:text-accent-hover" onClick={() => setLeftPanel('photos')}>
            {layer.assetId ? 'Replace' : 'Choose photo'}
          </button>
        }
      >
        {!layer.assetId && (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs leading-relaxed text-accent">
            This slot is empty. Pick an item in <strong>Media</strong> to fill it.
          </p>
        )}
        <Slider
          label="Crop zoom"
          display={`${cropScale.toFixed(2)}×`}
          min={1}
          max={4}
          step={0.05}
          value={cropScale}
          onChange={(v) => patch({ cropScale: v })}
          gesture={cropGesture}
          ariaLabel="Crop zoom"
        />
        <div className="grid grid-cols-2 gap-3">
          <Slider
            label="Horizontal"
            display={`${Math.round(layer.cropOffsetX * 100)}%`}
            min={-0.5}
            max={0.5}
            step={0.01}
            value={layer.cropOffsetX}
            onChange={(v) => patch({ cropOffsetX: v })}
            gesture={cropGesture}
            ariaLabel="Horizontal crop position"
          />
          <Slider
            label="Vertical"
            display={`${Math.round(layer.cropOffsetY * 100)}%`}
            min={-0.5}
            max={0.5}
            step={0.01}
            value={layer.cropOffsetY}
            onChange={(v) => patch({ cropOffsetY: v })}
            gesture={cropGesture}
            ariaLabel="Vertical crop position"
          />
        </div>
        <div className="flex items-start gap-3">
          <div className="grid w-[84px] shrink-0 grid-cols-3 gap-1 rounded-lg bg-bg-inset p-1" role="group" aria-label="Focal point">
            {FOCAL_POINTS.map((point) => {
              const active = point === activeFocalPoint;
              return (
                <button
                  key={point.label}
                  type="button"
                  title={point.label}
                  aria-label={point.label}
                  aria-pressed={active}
                  className={`flex aspect-square items-center justify-center rounded-md transition-colors ${
                    active ? 'bg-accent text-white' : 'text-ink-faint hover:bg-bg-hover hover:text-ink-dim'
                  }`}
                  onClick={() => patch({ cropOffsetX: point.x, cropOffsetY: point.y })}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </button>
              );
            })}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="field-label">Focal point</p>
            <p className="mt-0.5 text-xs text-ink">{activeFocalPoint?.label ?? 'Custom'}</p>
            <p className="mt-1 text-[11px] leading-snug text-ink-faint">Keeps this part of the photo in view when cropping.</p>
          </div>
        </div>
      </Section>
      {layer.assetId && <PhotoSwapSection key={layer.id} ids={[layer.id]} />}
      <ImageFrameSection layer={layer} />
      <ShadowSection layer={layer} />
    </>
  );
}

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 400;
const FONTS = ['Inter', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'system-ui'];

function TextInspector({ layer }: { layer: TextLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const u = (patch: Partial<TextLayer>) => updateLayer(layer.id, patch);
  const sizeGesture = useLayerGesture(layer.id, 'Change font size');
  const lineGesture = useLayerGesture(layer.id, 'Change line height');
  const spacingGesture = useLayerGesture(layer.id, 'Change letter spacing');
  const alignments = [
    { align: 'left' as const, Icon: AlignLeft, label: 'Align left' },
    { align: 'center' as const, Icon: AlignCenter, label: 'Align center' },
    { align: 'right' as const, Icon: AlignRight, label: 'Align right' },
  ];

  return (
    <>
      <Section title="Text">
        <textarea className="input min-h-[4.5rem] resize-y" rows={3} value={layer.text} onChange={(e) => u({ text: e.target.value })} aria-label="Text content" />
      </Section>
      <Section title="Typography">
        <select className="input" value={layer.fontFamily} onChange={(e) => u({ fontFamily: e.target.value })} aria-label="Font" style={{ fontFamily: layer.fontFamily }}>
          {FONTS.map((f) => (
            <option key={f} style={{ fontFamily: f }}>{f}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={layer.fontWeight} onChange={(e) => u({ fontWeight: Number(e.target.value) })} aria-label="Font weight">
            {[300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
          <NumberField prefix="Aa" ariaLabel="Font size" suffix="px" value={layer.fontSize} min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} onChange={(v) => u({ fontSize: v })} gesture={sizeGesture} />
        </div>
        <Slider
          label={layer.autoFit ? 'Largest size' : 'Size'}
          display={layer.fontSize}
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          value={layer.fontSize}
          onChange={(v) => u({ fontSize: v })}
          gesture={sizeGesture}
          valueText={`${layer.fontSize} pixels`}
        />
        <div className="flex items-center gap-2">
          <div className="segmented flex-1 grid-cols-3" role="group" aria-label="Text alignment">
            {alignments.map(({ align, Icon, label }) => (
              <button key={align} type="button" title={label} aria-label={label} aria-pressed={layer.align === align} className={`segmented-btn ${layer.align === align ? 'segmented-btn-active' : ''}`} onClick={() => u({ align })}>
                <Icon size={15} strokeWidth={1.9} aria-hidden />
              </button>
            ))}
          </div>
          <div className="segmented">
            <button type="button" className={`segmented-btn w-9 ${layer.italic ? 'segmented-btn-active' : ''}`} onClick={() => u({ italic: !layer.italic })} aria-pressed={layer.italic} title="Italic" aria-label="Italic">
              <Italic size={15} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md bg-bg-inset px-2.5 py-2">
          <div className="min-w-0">
            <p className="text-xs text-ink">Shrink to fit</p>
            <p className="text-[11px] leading-snug text-ink-faint">Text gets smaller to stay inside its box.</p>
          </div>
          <Switch checked={!!layer.autoFit} onChange={(autoFit) => u({ autoFit })} label="Shrink text to fit its box" />
        </div>
      </Section>
      <TextFillSection layer={layer} />
      <Section title="Spacing">
        <Slider
          label="Line height"
          display={layer.lineHeight.toFixed(2)}
          min={0.8}
          max={2.5}
          step={0.05}
          value={layer.lineHeight}
          onChange={(v) => u({ lineHeight: v })}
          gesture={lineGesture}
          valueText={String(layer.lineHeight)}
        />
        <Slider
          label="Letter spacing"
          display={layer.letterSpacing}
          min={-10}
          max={50}
          value={layer.letterSpacing}
          onChange={(v) => u({ letterSpacing: v })}
          gesture={spacingGesture}
          valueText={`${layer.letterSpacing} pixels`}
        />
      </Section>
      <TextOutlineSection layer={layer} />
      <TextHighlightSection layer={layer} />
      <ShadowSection layer={layer} />
    </>
  );
}

function ShapeInspector({ layer }: { layer: ShapeLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const u = (patch: Partial<ShapeLayer>) => updateLayer(layer.id, patch);
  const strokePickerValue = layer.stroke === 'transparent' ? '#000000' : layer.stroke;
  const cornerMax = Math.min(layer.width, layer.height) / 2;
  const cornerGesture = useLayerGesture(layer.id, 'Change corner radius');

  return (
    <>
    <Section title={layer.shape === 'ellipse' ? 'Ellipse' : 'Rectangle'}>
      <div>
        <p className="field-label mb-1">Fill</p>
        <ColorField value={layer.fill} onChange={(hex) => u({ fill: hex })} label="Shape fill" />
      </div>
      <div>
        <p className="field-label mb-1">Stroke</p>
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <ColorField value={strokePickerValue} onChange={(hex) => u({ stroke: hex })} label="Stroke color" />
          <NumberField prefix="W" ariaLabel="Stroke width" suffix="px" value={layer.strokeWidth} min={0} onChange={(v) => u({ strokeWidth: v })} />
        </div>
      </div>
      {layer.shape === 'rect' && (
        <Slider
          label="Corner radius"
          display={`${Math.round(layer.cornerRadius)} px`}
          min={0}
          max={cornerMax}
          value={layer.cornerRadius}
          onChange={(v) => u({ cornerRadius: v })}
          gesture={cornerGesture}
          valueText={`${Math.round(layer.cornerRadius)} pixels`}
        />
      )}
    </Section>
    <ShadowSection layer={layer} />
    </>
  );
}

function GridSection({ slideId }: { slideId: string }) {
  const doc = useEditor((s) => s.doc);
  const setSlideGrid = useEditor((s) => s.setSlideGrid);
  const setGridSpacingForAllSlides = useEditor((s) => s.setGridSpacingForAllSlides);
  const reattachGridSlots = useEditor((s) => s.reattachGridSlots);
  const linkGridSpacing = useEditor((s) => s.linkGridSpacing);
  const linked = useEditorSession((s) => s.gridLinked);
  const setGridLinked = useEditorSession((s) => s.setGridLinked);
  const gesture = useEditGesture('Adjust grid', `gesture:grid:${slideId}`);
  const live = useMemo(() => getLiveGrid(doc, slideId), [doc, slideId]);
  const gridSlides = useMemo(() => doc.slideOrder.filter((id) => getLiveGrid(doc, id)).length, [doc]);
  if (!live) return null;
  const { grid, template, movedSlots } = live;
  const shared = linkedMax(template, doc.format);
  const marginMax = linked ? shared : maxMargin(doc.format.width, doc.format.height);
  const margin = Math.min(grid.margin, marginMax);
  const gapMax = linked ? shared : maxGapFor(template, doc.format, margin);
  const gap = Math.min(grid.gap, gapMax);
  // Linked: either slider sets both, so the spacing stays equal.
  const setGap = (v: number) => setSlideGrid(slideId, linked ? { gap: v, margin: v } : { gap: v });
  const setMargin = (v: number) => setSlideGrid(slideId, linked ? { gap: v, margin: v } : { margin: v });
  const toggleLinked = () => {
    if (!linked) linkGridSpacing();
    setGridLinked(!linked);
  };
  return (
    <Section title="Photo grid" action={<span className="text-[11px] text-ink-faint">{template.name}</span>}>
      <LinkedSliders
        linked={linked}
        onToggle={toggleLinked}
        top={<Slider ariaLabel="Gap" label="Gap" display={`${Math.round(gap)} px`} min={0} max={gapMax} value={gap} onChange={setGap} gesture={gesture} valueText={`${Math.round(gap)} pixels`} />}
        bottom={<Slider ariaLabel="Outer margin" label="Outer margin" display={`${Math.round(margin)} px`} min={0} max={marginMax} value={margin} onChange={setMargin} gesture={gesture} valueText={`${Math.round(margin)} pixels`} />}
      />
      {movedSlots > 0 && (
        <>
          <p className="text-[11px] leading-relaxed text-ink-faint">{movedSlots} slot{movedSlots === 1 ? ' was' : 's were'} moved by hand and won’t follow these sliders.</p>
          <button className="btn btn-secondary btn-sm w-full" onClick={() => reattachGridSlots(slideId)}>
            Re-attach moved slots
          </button>
        </>
      )}
      {gridSlides > 1 && (
        <button className="btn btn-secondary btn-sm w-full" aria-label={`Apply grid spacing to all ${gridSlides} slides`} onClick={() => setGridSpacingForAllSlides(slideId)}>
          Apply to all {gridSlides} slides
        </button>
      )}
    </Section>
  );
}

/** Shown when no layer is selected: settings for the current slide. */
function SlideInspector({ onShowLayers }: { onShowLayers: () => void }) {
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const setLeftPanel = useEditorSession((s) => s.setLeftPanel);
  const slideOrder = useEditor((s) => s.doc.slideOrder);
  const slideId = selectedSlideId || slideOrder[0];
  const slide = useEditor((s) => s.doc.slides[slideId]);
  const setBackground = useEditor((s) => s.setBackground);
  const setBackgroundForAllSlides = useEditor((s) => s.setBackgroundForAllSlides);
  const addSlide = useEditor((s) => s.addSlide);
  const duplicateSlide = useEditor((s) => s.duplicateSlide);
  const deleteSlide = useEditor((s) => s.deleteSlide);
  const addTextLayer = useEditor((s) => s.addTextLayer);
  const requestImport = useEditorSession((s) => s.requestImport);
  if (!slide) return null;
  const index = slideOrder.indexOf(slideId);
  const quick = [
    ...SOLID_SWATCHES.slice(0, 5).map((color) => ({ kind: 'solid' as const, color })),
    ...GRADIENT_SWATCHES.slice(0, 3).map((g) => ({ kind: 'gradient' as const, ...g })),
  ];

  const empty = slide.layerOrder.length === 0;
  const quickStart = [
    { label: 'Photo grid', Icon: LayoutGrid, run: () => setLeftPanel('templates') },
    { label: 'Import media', Icon: ImagePlus, run: requestImport },
    { label: 'Text', Icon: Type, run: () => addTextLayer() },
    { label: 'Shape', Icon: Square, run: () => setLeftPanel('shapes') },
  ];

  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ring-white/15" style={{ background: backgroundCss(slide.background) }}>
          <span className="rounded bg-black/60 px-1 text-[10px] font-semibold tabular-nums text-white">{index + 1}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink">Slide {index + 1}</p>
          <p className="text-[11px] text-ink-faint">{slideOrder.length} slide{slideOrder.length === 1 ? '' : 's'} · {slide.layerOrder.length} layer{slide.layerOrder.length === 1 ? '' : 's'}</p>
        </div>
      </div>
      {empty && (
        <Section title="Start this slide">
          <div className="grid grid-cols-2 gap-1.5">
            {quickStart.map(({ label, Icon, run }) => (
              <button key={label} className="tile flex h-14 flex-col items-center justify-center gap-1 text-[11px] text-ink-dim hover:text-ink" onClick={run}>
                <Icon size={16} aria-hidden /> {label}
              </button>
            ))}
          </div>
        </Section>
      )}
      <GridSection slideId={slideId} />
      <Section title="Background" action={<button className="text-[11px] font-medium text-accent hover:text-accent-hover" onClick={() => setLeftPanel('background')}>More</button>}>
        <div className="grid grid-cols-8 gap-1.5">
          {quick.map((bg) => {
            const active = sameBackground(slide.background, bg);
            return (
              <button
                key={backgroundCss(bg)}
                type="button"
                className={`aspect-square rounded ring-1 ring-inset ring-white/10 transition-transform hover:scale-110 ${active ? 'outline outline-2 outline-offset-2 outline-accent' : ''}`}
                style={{ background: backgroundCss(bg) }}
                onClick={() => setBackground(bg)}
                aria-label={`Use background ${backgroundLabel(bg)}`}
                aria-pressed={active}
              />
            );
          })}
        </div>
        {slideOrder.length > 1 && (
          <button className="btn btn-secondary btn-sm w-full" onClick={() => setBackgroundForAllSlides(slide.background)}>
            Apply to all {slideOrder.length} slides
          </button>
        )}
      </Section>
      <SlidePhotoActions slideId={slideId} />
      <Section title="Slide">
        <div className="grid grid-cols-3 gap-1.5">
          <button className="btn btn-secondary btn-sm" onClick={() => addSlide(slideId)} title="Add a slide after this one">
            <Plus size={13} className="shrink-0" aria-hidden /> Add
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => duplicateSlide(slideId)}>
            <Copy size={13} className="shrink-0" aria-hidden /> Copy
          </button>
          <button className="btn btn-secondary btn-sm danger-hover" disabled={slideOrder.length <= 1} onClick={() => deleteSlide(slideId)}>
            <Trash2 size={13} className="shrink-0" aria-hidden /> Delete
          </button>
        </div>
      </Section>
      <div className="p-3">
        <div className="flex gap-2.5 rounded-lg border border-line p-3 text-[11px] leading-relaxed text-ink-faint">
          <MousePointerClick size={14} className="mt-0.5 shrink-0 text-ink-dim" aria-hidden />
          <p>
            Click something on the canvas to edit it, right-click for actions, or open the{' '}
            <button className="inline-flex items-center gap-0.5 font-medium text-accent hover:text-accent-hover" onClick={onShowLayers}>
              <Layers size={11} aria-hidden /> layer list
            </button>
            . Press <kbd className="kbd">{isMac ? '⌘' : 'Ctrl'} K</kbd> for every command.
          </p>
        </div>
      </div>
    </div>
  );
}

export function Inspector({ onShowLayers }: { onShowLayers: () => void }) {
  const selectedLayerId = useEditorSession((s) => s.selectedLayerId);
  const selectedIds = useEditorSession((s) => s.selectedLayerIds);
  const layer = useEditor((s) => selectedLayerId ? s.doc.layers[selectedLayerId] : undefined);
  const updateLayer = useEditor((s) => s.updateLayer);

  if (selectedIds.length > 1) return <SelectionInspector ids={selectedIds} />;
  if (!layer) return <SlideInspector onShowLayers={onShowLayers} />;

  const u = (patch: Parameters<typeof updateLayer>[1]) => updateLayer(layer.id, patch);

  return (
    <div className="text-ink">
      <LayerHeader layer={layer} />
      {layer.kind === 'image' && <ImageInspector key={layer.id} layer={layer} />}
      {layer.kind === 'text' && <TextInspector layer={layer} />}
      {layer.kind === 'shape' && <ShapeInspector layer={layer} />}
      <LayoutSection layer={layer} onPatch={u} />
      <ArrangeSection layer={layer} />
    </div>
  );
}
