import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Grid3x3, Heart, Maximize2, MessageCircle, Minimize2, MoreHorizontal, Send, SquareStack, X } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { slideScene } from '@/render/preview';
import { SlidePreviewCanvas } from '../SlidePreviewCanvas';
import { Segmented } from '../inspector/controls';

type Mode = 'feed' | 'grid';

/** Phone screen proportions (iPhone-class, ~19.5:9) and bezel. */
const SCREEN_RATIO = 2.165;
const BEZEL = 11;
/** Instagram's profile grid shows each post's cover at 3:4. */
const GRID_RATIO = 3 / 4;

const handleFor = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9._]+/g, '.').replace(/^\.+|\.+$/g, '') || 'your.account';

function useSlides() {
  const doc = useEditor((s) => s.doc);
  return useMemo(() => doc.slideOrder.map((id) => ({ id, scene: slideScene(doc, id) })), [doc]);
}

/** Swipeable media track: drag, trackpad swipe, arrow keys and arrow buttons. */
function Carousel({ width, height, index, onIndex, children }: { width: number; height: number; index: number; onIndex: (i: number) => void; children: (slide: ReturnType<typeof useSlides>[number], width: number, height: number) => ReactNode }) {
  const slides = useSlides();
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; t: number; id: number } | null>(null);
  const wheel = useRef({ acc: 0, locked: false, timer: 0 });
  const count = slides.length;
  const go = useCallback((i: number) => onIndex(Math.max(0, Math.min(count - 1, i))), [count, onIndex]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, t: performance.now(), id: e.pointerId };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    let next = e.clientX - drag.current.x;
    // Rubber-band past the first and last slide.
    if ((index === 0 && next > 0) || (index === count - 1 && next < 0)) next /= 3;
    setDx(next);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start) return;
    const moved = e.clientX - start.x;
    const velocity = moved / Math.max(1, performance.now() - start.t);
    setDx(0);
    if (moved < -width * 0.2 || velocity < -0.45) go(index + 1);
    else if (moved > width * 0.2 || velocity > 0.45) go(index - 1);
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const w = wheel.current;
    window.clearTimeout(w.timer);
    w.timer = window.setTimeout(() => { w.acc = 0; w.locked = false; }, 180);
    if (w.locked) return;
    w.acc += e.deltaX;
    if (Math.abs(w.acc) > 40) { go(index + (w.acc > 0 ? 1 : -1)); w.locked = true; }
  };

  return (
    <div className="group relative overflow-hidden bg-black touch-pan-y select-none" style={{ width, height }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
      <div className="flex h-full" style={{ transform: `translateX(${-index * width + dx}px)`, transition: drag.current ? 'none' : 'transform 320ms cubic-bezier(.2,.8,.2,1)' }}>
        {slides.map((slide) => (
          <div key={slide.id} className="relative flex h-full shrink-0 items-center justify-center overflow-hidden" style={{ width }}>
            {children(slide, width, height)}
          </div>
        ))}
      </div>
      {count > 1 && (
        <>
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">{index + 1}/{count}</span>
          {index > 0 && (
            <button type="button" aria-label="Previous slide" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(index - 1)} className="absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-800 opacity-0 shadow transition-opacity group-hover:opacity-100">
              <ChevronLeft size={16} strokeWidth={2.5} aria-hidden />
            </button>
          )}
          {index < count - 1 && (
            <button type="button" aria-label="Next slide" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(index + 1)} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-800 opacity-0 shadow transition-opacity group-hover:opacity-100">
              <ChevronRight size={16} strokeWidth={2.5} aria-hidden />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Avatar({ size }: { size: number }) {
  return (
    <span className="shrink-0 rounded-full p-[2px]" style={{ width: size, height: size, background: 'linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)' }}>
      <span className="flex h-full w-full items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-violet-400 to-fuchsia-500 text-[10px] font-bold text-white" />
    </span>
  );
}

function StatusBar({ dark }: { dark?: boolean }) {
  return (
    <div className={`relative flex h-11 shrink-0 items-center justify-between px-7 text-[13px] font-semibold ${dark ? 'text-white' : 'text-black'}`}>
      <span>9:41</span>
      <span className="absolute left-1/2 top-2.5 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black" aria-hidden />
      <span className="flex items-center gap-1" aria-hidden>
        <span className="flex items-end gap-[2px]">{[4, 6, 8, 10].map((h) => <span key={h} className={`w-[3px] rounded-sm ${dark ? 'bg-white' : 'bg-black'}`} style={{ height: h }} />)}</span>
        <span className={`ml-1 h-[11px] w-[22px] rounded-[3px] border ${dark ? 'border-white/70' : 'border-black/60'} p-[1.5px]`}><span className={`block h-full w-3/4 rounded-[1px] ${dark ? 'bg-white' : 'bg-black'}`} /></span>
      </span>
    </div>
  );
}

function FeedScreen({ screenWidth, index, onIndex }: { screenWidth: number; index: number; onIndex: (i: number) => void }) {
  const format = useEditor((s) => s.doc.format);
  const name = useEditor((s) => s.doc.name);
  const count = useEditor((s) => s.doc.slideOrder.length);
  // Feed posts display between 1.91:1 and 4:5; taller formats are cropped to 4:5.
  const ratio = Math.max(0.8, Math.min(1.91, format.width / format.height));
  const mediaHeight = screenWidth / ratio;
  const handle = handleFor(name);
  return (
    <div className="flex h-full flex-col bg-white text-black">
      <StatusBar />
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-black/5 px-3.5">
        <ChevronLeft size={24} aria-hidden />
        <span className="text-[15px] font-semibold">Posts</span>
        <span className="w-6" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
        <div className="flex h-12 items-center gap-2.5 px-3">
          <Avatar size={32} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{handle}</span>
          <MoreHorizontal size={18} aria-hidden />
        </div>
        <Carousel width={screenWidth} height={mediaHeight} index={index} onIndex={onIndex}>
          {(slide, w, h) => {
            // Cover-fit the slide in the feed frame (only taller-than-4:5 formats lose anything).
            const scale = Math.max(w / format.width, h / format.height);
            return <SlidePreviewCanvas scene={slide.scene} format={format} width={format.width * scale} height={format.height * scale} checkerboard />;
          }}
        </Carousel>
        <div className="relative flex h-11 items-center gap-3.5 px-3">
          <Heart size={23} aria-hidden /><MessageCircle size={23} className="-scale-x-100" aria-hidden /><Send size={22} aria-hidden />
          {count > 1 && (
            <span className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1" aria-label={`Slide ${index + 1} of ${count}`}>
              {Array.from({ length: count }, (_, i) => <span key={i} className={`rounded-full transition-all ${i === index ? 'h-1.5 w-1.5 bg-[#0095f6]' : 'h-[5px] w-[5px] bg-black/20'}`} />)}
            </span>
          )}
          <Bookmark size={23} className="ml-auto" aria-hidden />
        </div>
        <div className="space-y-1 px-3 pb-6 text-[13px] leading-snug">
          <p className="font-semibold">1,284 likes</p>
          <p><span className="font-semibold">{handle}</span> {name || 'Untitled'} · Swipe through →</p>
          <p className="text-black/45">View all 24 comments</p>
          <p className="text-[11px] uppercase tracking-wide text-black/40">Just now</p>
        </div>
      </div>
    </div>
  );
}

function StoryScreen({ screenWidth, screenHeight, index, onIndex }: { screenWidth: number; screenHeight: number; index: number; onIndex: (i: number) => void }) {
  const format = useEditor((s) => s.doc.format);
  const name = useEditor((s) => s.doc.name);
  const count = useEditor((s) => s.doc.slideOrder.length);
  return (
    <div className="relative h-full bg-black">
      <Carousel width={screenWidth} height={screenHeight} index={index} onIndex={onIndex}>
        {(slide, w, h) => {
          const scale = Math.max(w / format.width, h / format.height);
          return <SlidePreviewCanvas scene={slide.scene} format={format} width={format.width * scale} height={format.height * scale} checkerboard />;
        }}
      </Carousel>
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/50 to-transparent pb-8">
        <StatusBar dark />
        <div className="flex gap-1 px-2.5">{Array.from({ length: count }, (_, i) => <span key={i} className={`h-[2.5px] flex-1 rounded-full ${i <= index ? 'bg-white' : 'bg-white/35'}`} />)}</div>
        <div className="mt-2.5 flex items-center gap-2 px-3 text-[13px] font-semibold text-white"><Avatar size={30} />{handleFor(name)}<span className="font-normal text-white/70">1m</span></div>
      </div>
    </div>
  );
}

/** A slide cover-fitted into a `w`×`h` tile, like Instagram's grid crop. */
function CoverTile({ w, h }: { w: number; h: number }) {
  const slides = useSlides();
  const format = useEditor((s) => s.doc.format);
  const first = slides[0];
  if (!first) return null;
  const scale = Math.max(w / format.width, h / format.height);
  return (
    <div className="relative overflow-hidden" style={{ width: w, height: h }}>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <SlidePreviewCanvas scene={first.scene} format={format} width={format.width * scale} height={format.height * scale} checkerboard />
      </div>
      {slides.length > 1 && <SquareStack size={15} className="absolute right-1.5 top-1.5 text-white drop-shadow" aria-label="Carousel" />}
    </div>
  );
}

const PLACEHOLDER_TONES = ['#e8e3dc', '#d9dde3', '#e5dde6', '#dde5df', '#ece6d8', '#dad9e4', '#e4dcd6', '#d7e1e6'];

function GridScreen({ screenWidth }: { screenWidth: number }) {
  const name = useEditor((s) => s.doc.name);
  const handle = handleFor(name);
  const tileW = (screenWidth - 2) / 3;
  const tileH = tileW / GRID_RATIO;
  return (
    <div className="flex h-full flex-col bg-white text-black">
      <StatusBar />
      <div className="flex h-10 shrink-0 items-center justify-center text-[15px] font-semibold">{handle}</div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        <div className="flex items-center gap-5 px-4 py-2">
          <Avatar size={76} />
          <div className="grid flex-1 grid-cols-3 text-center text-[12px] leading-tight">
            {[['48', 'posts'], ['2,031', 'followers'], ['312', 'following']].map(([n, l]) => <span key={l}><b className="block text-[15px]">{n}</b>{l}</span>)}
          </div>
        </div>
        <div className="px-4 pb-3 text-[12px] leading-snug"><b>{name || 'Untitled'}</b><br /><span className="text-black/55">Made with Open-SCRL</span></div>
        <div className="grid grid-cols-2 gap-1.5 px-4 pb-3">{['Edit profile', 'Share profile'].map((l) => <span key={l} className="rounded-lg bg-black/[0.06] py-1.5 text-center text-[12px] font-semibold">{l}</span>)}</div>
        <div className="flex border-t border-black/10">
          <span className="flex flex-1 justify-center border-b border-black py-2"><Grid3x3 size={20} aria-hidden /></span>
          <span className="flex flex-1 justify-center py-2 text-black/35"><SquareStack size={20} aria-hidden /></span>
        </div>
        <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(3, ${tileW}px)` }}>
          <CoverTile w={tileW} h={tileH} />
          {PLACEHOLDER_TONES.map((tone, i) => <span key={i} style={{ width: tileW, height: tileH, background: `linear-gradient(160deg, ${tone}, ${PLACEHOLDER_TONES[(i + 3) % PLACEHOLDER_TONES.length]})` }} />)}
        </div>
      </div>
    </div>
  );
}

/** The first slide with Instagram's 3:4 grid crop outlined. */
function CropGuide() {
  const slides = useSlides();
  const format = useEditor((s) => s.doc.format);
  const first = slides[0];
  if (!first) return null;
  const ratio = format.width / format.height;
  const width = 248, height = width / ratio;
  const crop = ratio > GRID_RATIO ? { w: height * GRID_RATIO, h: height } : { w: width, h: width / GRID_RATIO };
  const matches = Math.abs(ratio - GRID_RATIO) < 0.01;
  return (
    <div className="w-[280px] rounded-xl border border-line-strong bg-bg-overlay p-4 shadow-lift">
      <p className="text-xs font-semibold text-ink">Profile grid crop</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
        {matches ? 'Your format already matches the 3:4 grid, so nothing is cropped.' : 'Your profile shows the first slide cropped to 3:4. Keep faces and titles inside the frame.'}
      </p>
      <div className="relative mx-auto mt-3 overflow-hidden rounded-md" style={{ width, height }}>
        <SlidePreviewCanvas scene={first.scene} format={format} width={width} height={height} checkerboard />
        {!matches && (
          <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm ring-2 ring-white" style={{ width: crop.w, height: crop.h, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }} />
        )}
      </div>
    </div>
  );
}

export function PhonePreview() {
  const close = useEditorView((s) => s.setPreviewOpen);
  const format = useEditor((s) => s.doc.format);
  const count = useEditor((s) => s.doc.slideOrder.length);
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const startIndex = useEditor((s) => Math.max(0, s.doc.slideOrder.indexOf(selectedSlideId)));
  const [mode, setMode] = useState<Mode>('feed');
  const [index, setIndex] = useState(startIndex);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [fullscreen, setFullscreen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const story = format.width / format.height < 0.7;

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    const onFullscreen = () => setFullscreen(document.fullscreenElement === root.current);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => { window.removeEventListener('resize', onResize); document.removeEventListener('fullscreenchange', onFullscreen); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Capture phase, so editor shortcuts never see keys while the preview is open.
      if (e.key === 'Escape' && !document.fullscreenElement) close(false);
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(count - 1, i + 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      else if (e.key === 'f') void toggleFullscreen();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.current?.requestFullscreen?.().catch(() => undefined);
  };

  const chrome = fullscreen ? 24 : 120;
  const screenHeight = Math.min(844, viewport.h - chrome - BEZEL * 2);
  const screenWidth = Math.round(screenHeight / SCREEN_RATIO);

  return (
    <div ref={root} className="fixed inset-0 z-[1060] flex flex-col bg-[#09090b]/95 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Phone preview">
      {!fullscreen && (
        <div className="flex h-14 shrink-0 items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <h2 className="text-[13px] font-semibold text-ink">Preview</h2>
            <div className="w-[190px]">
              <Segmented label="Preview" value={mode} onChange={setMode} options={[{ value: 'feed', label: story ? 'Story' : 'Feed' }, { value: 'grid', label: 'Profile grid' }]} />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleFullscreen()} title="Full screen (F)"><Maximize2 size={14} aria-hidden /> Full screen</button>
            <button type="button" className="icon-btn" onClick={() => close(false)} title="Close preview (Esc)" aria-label="Close preview"><X size={16} aria-hidden /></button>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center gap-10 pb-6">
        <div className="relative shrink-0 rounded-[54px] bg-[#1b1b1f] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={{ padding: BEZEL }}>
          <div className="relative overflow-hidden rounded-[44px] bg-white" style={{ width: screenWidth, height: screenHeight }}>
            {mode === 'grid'
              ? <GridScreen screenWidth={screenWidth} />
              : story
                ? <StoryScreen screenWidth={screenWidth} screenHeight={screenHeight} index={index} onIndex={setIndex} />
                : <FeedScreen screenWidth={screenWidth} index={index} onIndex={setIndex} />}
            <span className="pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[120px] -translate-x-1/2 rounded-full bg-black/80 mix-blend-difference" aria-hidden />
          </div>
        </div>
        {mode === 'grid' && !fullscreen && viewport.w > 900 && <CropGuide />}
      </div>
      {fullscreen && (
        <button type="button" className="btn btn-ghost btn-sm absolute right-4 top-4" onClick={() => void toggleFullscreen()} title="Exit full screen (Esc)"><Minimize2 size={14} aria-hidden /> Exit</button>
      )}
      {!fullscreen && mode === 'feed' && count > 1 && <p className="pb-4 text-center text-[11px] text-ink-faint">Drag, swipe with two fingers, or use ← → to flip through slides.</p>}
    </div>
  );
}
