import { ArrowRight, Loader2 } from 'lucide-react';
import type { Format } from '@/types';
import { FORMATS } from '@/lib/format';
import { fitBox } from './projectDisplay';

interface NewCarouselCardProps {
  format: Format;
  onFormatChange: (format: Format) => void;
  name: string;
  onNameChange: (name: string) => void;
  creating: boolean;
  /** Another create/open is in flight; disables the controls. */
  busy: boolean;
  onSubmit: () => void;
}

function FormatChip({ format, selected, onSelect }: { format: Format; selected: boolean; onSelect: () => void }) {
  const box = fitBox(format, 30, 40);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex min-h-[108px] w-[104px] shrink-0 snap-start flex-col items-center justify-between gap-2 rounded-2xl px-1.5 pb-2.5 pt-3 text-center ring-1 ring-inset transition-[background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 ${
        selected ? 'bg-accent-soft ring-2 ring-accent' : 'bg-bg-inset ring-line active:bg-bg-hover'
      }`}
    >
      <span className="flex h-11 items-center justify-center">
        <span
          className={`block rounded-[4px] transition-colors ${selected ? 'bg-accent shadow-[0_0_18px_rgba(124,92,255,0.55)]' : 'bg-line-strong'}`}
          style={box}
          aria-hidden
        />
      </span>
      <span className="block w-full">
        <span className={`block text-[12px] font-semibold leading-tight ${selected ? 'text-ink' : 'text-ink-dim'}`}>{format.name}</span>
        <span className="mt-0.5 block text-[11px] tabular-nums leading-tight text-ink-faint">
          {format.width}×{format.height}
        </span>
      </span>
    </button>
  );
}

export function NewCarouselCard({ format, onFormatChange, name, onNameChange, creating, busy, onSubmit }: NewCarouselCardProps) {
  return (
    <form
      aria-labelledby="home-new-title"
      className="rounded-[22px] border border-line bg-bg-panel p-4 shadow-soft"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit();
      }}
    >
      <h2 id="home-new-title" className="text-[17px] font-semibold tracking-tight">
        New carousel
      </h2>
      <p className="mt-0.5 text-[13px] text-ink-faint">Pick a canvas size. You can change it later.</p>

      <div
        role="radiogroup"
        aria-label="Canvas format"
        className="home-hscroll -mx-4 mt-3.5 flex snap-x snap-proximity gap-2 overflow-x-auto scroll-px-4 px-4 pb-1"
      >
        {FORMATS.map((option) => (
          <FormatChip key={option.name} format={option} selected={option.name === format.name} onSelect={() => onFormatChange(option)} />
        ))}
      </div>

      <label className="mt-3 flex h-12 items-center gap-3 rounded-xl border border-transparent bg-bg-inset px-3.5 transition-colors focus-within:border-accent">
        <span className="w-10 shrink-0 text-[13px] text-ink-faint">Name</span>
        <input
          className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint focus-visible:ring-0"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Untitled"
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="go"
          maxLength={120}
          aria-label="Project name"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        aria-busy={creating}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(124,92,255,0.8)] transition-[background-color,transform,opacity] duration-150 ease-out active:scale-[0.98] active:bg-accent-hover disabled:opacity-60 motion-reduce:active:scale-100"
      >
        {creating ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
        {creating ? 'Creating…' : 'Create carousel'}
        {!creating && <ArrowRight size={18} strokeWidth={2.25} aria-hidden />}
      </button>
    </form>
  );
}
