import type { ComponentType, ReactNode } from 'react';
import { Download, Loader2, Package, Smartphone } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { useExport } from '@/editor/exportStore';
import { useToasts } from '@/store/toasts';

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;

/**
 * How far along a carousel export is, from the progress labels `exportInstagramCarousel` reports
 * ("Slide 2/5 · image", "Slide 2/5 · 40%", "Packaging…"). Null when the label has no position yet.
 */
function progressFraction(progress: string): number | null {
  if (progress.startsWith('Packaging')) return 1;
  const match = /^Slide (\d+)\/(\d+)(?: · (\d+)%)?/.exec(progress);
  if (!match) return null;
  const [, index, total, percent] = match;
  return Math.min(1, (Number(index) - 1 + (percent ? Number(percent) / 100 : 0)) / Number(total));
}

function ProgressBar({ fraction, label }: { fraction: number | null; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25"
    >
      <div
        className={`h-full rounded-full bg-white transition-[width] duration-200 ease-out ${fraction === null ? 'w-full animate-pulse motion-reduce:animate-none' : ''}`}
        style={fraction === null ? undefined : { width: `${Math.max(4, fraction * 100)}%` }}
      />
    </div>
  );
}

function ActionCard({
  Icon,
  title,
  description,
  onClick,
  disabled,
  busy,
  primary,
  children,
}: {
  Icon: Icon;
  title: string;
  description: ReactNode;
  onClick: () => void;
  /** Dimmed and inert (another export is running). */
  disabled?: boolean;
  /** This card's own work is running: keep it bright and show a spinner. */
  busy?: boolean;
  primary?: boolean;
  children?: ReactNode;
}) {
  const surface = primary ? 'bg-accent text-white active:bg-accent-hover' : 'bg-bg-inset text-ink ring-1 ring-inset ring-line-strong active:bg-bg-hover';
  const tile = primary ? 'bg-white/20 text-white' : 'bg-accent-soft text-accent';
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      className={`block w-full touch-manipulation rounded-[14px] p-3.5 text-left transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 ${surface}`}
      onClick={() => {
        if (!busy) onClick();
      }}
    >
      <span className="flex items-center gap-3.5">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tile}`}>
          {busy ? <Loader2 size={22} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Icon size={22} strokeWidth={1.8} aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-tight">{title}</span>
          <span className={`mt-1 block text-[13px] leading-snug ${primary ? 'text-white/80' : 'text-ink-dim'}`}>{description}</span>
        </span>
      </span>
      {children}
    </button>
  );
}

/** Export and preview options, shown inside the mobile export sheet. */
export function MobileExportPanel({ onDone }: { onDone: () => void }) {
  const slideCount = useEditor((s) => s.doc.slideOrder.length);
  const format = useEditor((s) => s.doc.format);
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const slideNumber = useEditor((s) => Math.max(0, s.doc.slideOrder.indexOf(selectedSlideId)) + 1);
  const exporting = useExport((s) => s.exporting);
  const progress = useExport((s) => s.progress);
  const exportCarousel = useExport((s) => s.exportCarousel);
  const exportCurrentSlide = useExport((s) => s.exportCurrentSlide);

  // Only the carousel export reports progress, so a bare `exporting` means a single slide.
  const carouselBusy = exporting && progress !== '';
  const slideBusy = exporting && progress === '';

  const saveSlide = async () => {
    const { addToast } = useToasts.getState();
    try {
      await exportCurrentSlide();
      addToast(`Slide ${slideNumber} downloaded as a PNG.`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not save the slide.', 'error');
    }
  };

  return (
    <div className="space-y-3 px-4 pb-4 pt-1">
      <p className="text-[13px] tabular-nums text-ink-dim">
        {slideCount} {slideCount === 1 ? 'slide' : 'slides'} · {format.name} · {format.width}×{format.height}
      </p>

      <ActionCard
        primary
        Icon={Package}
        title="Export carousel"
        description={carouselBusy ? <span role="status">{progress}</span> : 'Every slide in one ZIP'}
        busy={carouselBusy}
        disabled={slideBusy}
        onClick={() => void exportCarousel()}
      >
        {carouselBusy && <ProgressBar fraction={progressFraction(progress)} label="Carousel export progress" />}
      </ActionCard>

      <ActionCard
        Icon={Download}
        title="Save this slide"
        description={slideBusy ? <span role="status">Rendering slide {slideNumber}…</span> : `Slide ${slideNumber} as a PNG image`}
        busy={slideBusy}
        disabled={carouselBusy}
        onClick={() => void saveSlide()}
      />

      <ActionCard
        Icon={Smartphone}
        title="Preview on phone"
        description="Swipe through it like an Instagram post"
        disabled={exporting}
        onClick={() => {
          useEditorView.getState().setPreviewOpen(true);
          onDone();
        }}
      />

      <p className="px-1 pt-1 text-[12px] leading-relaxed text-ink-faint">
        The carousel ZIP holds a PNG for each still slide and an MP4 for each animated one, numbered in order. Everything is rendered on this device.
      </p>
    </div>
  );
}
