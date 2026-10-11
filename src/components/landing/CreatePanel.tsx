import { forwardRef, useRef, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import type { Format } from '@/types';
import { FORMATS } from '@/lib/format';
import { fitBox } from '../home/projectDisplay';
import { radioKeyTarget } from '../home/radioKeys';

function FormatCard({ format, selected, onSelect, tabbable }: { format: Format; selected: boolean; onSelect: () => void; tabbable: boolean }) {
  const box = fitBox(format, 48, 60);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabbable ? 0 : -1}
      onClick={onSelect}
      className="home-format"
    >
      <span className="home-format-well">
        <span className="home-format-frame" style={box} aria-hidden />
        <span className="home-format-check" aria-hidden><Check size={11} strokeWidth={3} /></span>
      </span>
      <span className="home-format-name">{format.name}</span>
      <span className="home-format-size">{format.width} × {format.height}</span>
    </button>
  );
}

interface CreatePanelProps {
  name: string;
  onNameChange: (name: string) => void;
  format: Format;
  onFormatChange: (format: Format) => void;
  creating: boolean;
  busy: boolean;
  onSubmit: () => void;
  /** Secondary starting points shown under the main row. */
  children?: ReactNode;
}

/** Pick a size, name it, create: one row of format tiles over one row of input and action. */
export const CreatePanel = forwardRef<HTMLInputElement, CreatePanelProps>(function CreatePanel(
  { name, onNameChange, format, onFormatChange, creating, busy, onSubmit, children },
  nameRef,
) {
  const group = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, FORMATS.findIndex((f) => f.name === format.name));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onSubmit();
  };
  const moveSelection = (event: React.KeyboardEvent) => {
    const target = radioKeyTarget(event, selectedIndex, FORMATS.length);
    if (target === null) return;
    event.preventDefault();
    onFormatChange(FORMATS[target]);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[target]?.focus();
  };

  return (
    <section className="home-new" aria-label="Create a carousel">
      <form className="home-new-panel" onSubmit={submit} aria-labelledby="home-new-title">
        <div className="home-section-head">
          <h2 id="home-new-title" className="home-section-title">New carousel</h2>
          <span className="home-section-aside">Sizes can be changed later</span>
        </div>
        <div className="home-formats" role="radiogroup" aria-label="Canvas format" ref={group} onKeyDown={moveSelection}>
          {FORMATS.map((option, index) => (
            <FormatCard key={option.name} format={option} selected={index === selectedIndex} tabbable={index === selectedIndex} onSelect={() => onFormatChange(option)} />
          ))}
        </div>
        <div className="home-new-row">
          <label className="home-field">
            <span className="sr-only">Project name</span>
            <input
              ref={nameRef}
              className="home-input"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Untitled"
              autoComplete="off"
              maxLength={120}
            />
          </label>
          <button type="submit" className="home-button home-button-lg home-create-button" disabled={busy} aria-busy={creating}>
            {creating ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            {creating ? 'Creating…' : 'Create carousel'}
            {!creating && <ArrowRight size={16} strokeWidth={2.25} aria-hidden />}
          </button>
        </div>
      </form>
      {children}
    </section>
  );
});
