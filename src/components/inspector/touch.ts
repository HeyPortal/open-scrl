import { createContext, useContext } from 'react';

/**
 * Set by the mobile inspector sheet. When the context is `null` (desktop) the inspector renders
 * exactly as before; when present, the shared controls swap desktop-only affordances (the side
 * panel's Media tab, drag-to-adjust labels, keyboard hints) for touch-friendly ones.
 */
export interface TouchInspectorHost {
  /** Opens the mobile photo picker for the selected frame. Omit to hide the Replace link. */
  onReplacePhoto?: () => void;
}

export const TouchInspectorContext = createContext<TouchInspectorHost | null>(null);

export const useTouchInspector = () => useContext(TouchInspectorContext);
