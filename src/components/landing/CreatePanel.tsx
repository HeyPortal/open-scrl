import { forwardRef, useRef, type FormEvent } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { Format } from '@/types';
import { FORMATS } from '@/lib/format';
import { fitBox } from '../home/projectDisplay';
import { radioKeyTarget } from '../home/radioKeys';

function FormatCard({ format, selected, onSelect, tabbable }: { format: Format; selected: boolean; onSelect: () => void; tabbable: boolean }) {
  const box = fitBox(format, 42, 56);
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
}

/** Compact new-project controls, like the Mac welcome screen. */
export const CreatePanel = forwardRef<HTMLInputElement, CreatePanelProps>(function CreatePanel(
  { name, onNameChange, format, onFormatChange, creating, busy, onSubmit },
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
    <form className="home-new-panel" onSubmit={submit} aria-labelledby="home-new-title">
      <h2 id="home-new-title" className="home-section-title">New carousel</h2>
      <div className="home-new-formats">
        <span className="home-field-label" id="format-label">Canvas format</span>
        <div className="home-formats" role="radiogroup" aria-labelledby="format-label" ref={group} onKeyDown={moveSelection}>
          {FORMATS.map((option, index) => (
            <FormatCard key={option.name} format={option} selected={index === selectedIndex} tabbable={index === selectedIndex} onSelect={() => onFormatChange(option)} />
          ))}
        </div>
      </div>
      <label className="home-field">
        <span className="home-field-label">Project name</span>
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
      <button type="submit" className="btn-primary home-button home-button-lg" disabled={busy} aria-busy={creating}>
        {creating ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
        {creating ? 'Creating…' : 'Create & open editor'}
      </button>
    </form>
  );
});
