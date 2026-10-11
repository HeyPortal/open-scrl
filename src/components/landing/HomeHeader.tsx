import { Lock, Plus } from 'lucide-react';
import { AppLogo } from '../AppLogo';

/**
 * Sticky top line: brand and the local-storage note. Once creation scrolls out of view, a
 * "New carousel" shortcut fades in to bring it back.
 */
export function HomeHeader({ onNew, showNew, raised }: { onNew: () => void; showNew: boolean; raised: boolean }) {
  return (
    <header className="home-header" data-raised={raised}>
      <div className="home-header-inner">
        <div className="home-brand">
          <AppLogo className="home-logo" />
          <span className="home-brand-name app-wordmark">Open-SCRL</span>
        </div>
        <div className="home-header-actions">
          <span className="home-note" title="Projects are stored in this browser and never uploaded">
            <Lock size={12} strokeWidth={2.25} aria-hidden />
            Saved on this device
          </span>
          <button type="button" className="home-button home-button-sm home-header-new" data-visible={showNew} tabIndex={showNew ? 0 : -1} aria-hidden={!showNew} onClick={onNew}>
            <Plus size={15} strokeWidth={2.5} aria-hidden />
            New carousel
          </button>
        </div>
      </div>
    </header>
  );
}
