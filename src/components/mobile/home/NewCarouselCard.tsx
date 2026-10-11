import { forwardRef } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import type { Format } from '@/types';
import { FORMATS } from '@/lib/format';
import { fitBox } from '../../home/projectDisplay';

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
  const box = fitBox(format, 38, 52);
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className="home-format">
      <span className="home-format-well">
        <span className="home-format-frame" style={box} aria-hidden />
        <span className="home-format-check" aria-hidden><Check size={11} strokeWidth={3} /></span>
      </span>
      <span className="home-format-name">{format.name}</span>
      <span className="home-format-size">{format.width}×{format.height}</span>
    </button>
  );
}

export const NewCarouselCard = forwardRef<HTMLFormElement, NewCarouselCardProps>(function NewCarouselCard(
  { format, onFormatChange, name, onNameChange, creating, busy, onSubmit },
  ref,
) {
  return (
    <form
      ref={ref}
      aria-labelledby="home-new-title"
      className="home-create"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit();
      }}
    >
      <h2 id="home-new-title" className="home-section-title">New carousel</h2>

      <div role="radiogroup" aria-label="Canvas format" className="home-formats home-hscroll">
        {FORMATS.map((option) => (
          <FormatChip key={option.name} format={option} selected={option.name === format.name} onSelect={() => onFormatChange(option)} />
        ))}
      </div>

      <label className="home-name">
        <input
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

      <button type="submit" disabled={busy} aria-busy={creating} className="home-button home-button-lg home-create-button">
        {creating ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
        {creating ? 'Creating…' : 'Create carousel'}
        {!creating && <ArrowRight size={17} strokeWidth={2.25} aria-hidden />}
      </button>
    </form>
  );
});
