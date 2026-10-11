import { ExportPanel } from '../export/ExportPanel';

/** The web export controls inside the phone's resizable sheet. */
export function MobileExportPanel({ onDone }: { onDone: () => void }) {
  return <ExportPanel onDone={onDone} />;
}
