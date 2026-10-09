import { Inspector } from '@/components/Inspector';
import './selection/inspector.css';

const noop = () => undefined;

/**
 * Properties for the current selection, shown inside the mobile inspector sheet.
 *
 * It is the desktop `Inspector` (so every control and edit behaves identically) wrapped in a
 * `.mobile-inspector` container whose CSS enlarges inputs, sliders and buttons for touch.
 * `onReplacePhoto` lets the shell open its photo picker from the Photo section's Replace link;
 * without it the link is hidden (the selection bar has its own Replace button).
 */
export function MobileInspector({ onReplacePhoto }: { onReplacePhoto?: () => void } = {}) {
  return (
    <div className="mobile-inspector">
      <Inspector onShowLayers={noop} touch={{ onReplacePhoto }} />
    </div>
  );
}
