import { HardDrive, LayoutGrid, Plus } from 'lucide-react';

/** Floating glass island across the top: brand, privacy note and a shortcut to the create panel. */
export function HomeHeader({ onNew }: { onNew: () => void }) {
  return (
    <header className="home-header studio-glass">
      <div className="home-brand">
        <span className="home-logo" aria-hidden><LayoutGrid size={16} strokeWidth={2.25} /></span>
        <span className="home-brand-name">Open-SCRL</span>
      </div>
      <div className="home-header-actions">
        <span className="home-chip" title="Projects are stored in this browser and never uploaded">
          <HardDrive size={13} aria-hidden />
          Saved on this device
        </span>
        <button type="button" className="home-button home-button-sm" onClick={onNew}>
          <Plus size={15} strokeWidth={2.5} aria-hidden />
          New carousel
        </button>
      </div>
    </header>
  );
}
