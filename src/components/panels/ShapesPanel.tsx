import { Circle, Square } from 'lucide-react';
import { useEditor } from '@/store/editor';

export function ShapesPanel() {
  const add = useEditor((s) => s.addShapeLayer);
  return (
    <div className="flex flex-col h-full">
      <div className="panel-section">Shapes</div>
      <div className="grid grid-cols-2 gap-2 px-3">
        <button className="card flex flex-col items-center gap-2 py-6 hover:border-accent" onClick={() => add('rect')}>
          <Square size={32} strokeWidth={1.5} />
          <span className="text-xs">Rectangle</span>
        </button>
        <button className="card flex flex-col items-center gap-2 py-6 hover:border-accent" onClick={() => add('ellipse')}>
          <Circle size={32} strokeWidth={1.5} />
          <span className="text-xs">Ellipse</span>
        </button>
      </div>
    </div>
  );
}
