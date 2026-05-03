import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';

export function RightPanel() {
  return (
    <div className="w-64 shrink-0 bg-bg-rail border-l border-line flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-[32%] max-h-[58%] flex-1 overflow-auto border-b border-line scrollbar-thin">
          <LayersPanel />
        </div>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <Inspector />
        </div>
      </div>
    </div>
  );
}
