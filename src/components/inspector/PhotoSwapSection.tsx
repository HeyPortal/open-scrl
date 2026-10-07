import { useMemo, useState } from 'react';
import { ArrowLeftRight, MoveRight } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { canSwapPhotoFrames } from '@/core/document/photos';
import { Section } from '../ui';

interface Target {
  id: string;
  label: string;
  empty: boolean;
}

/** Trade photos between two selected frames, or move one photo into another frame. */
export function PhotoSwapSection({ ids }: { ids: string[] }) {
  const doc = useEditor((s) => s.doc);
  const swapPhotos = useEditor((s) => s.swapPhotos);
  const [targetId, setTargetId] = useState('');
  const [failed, setFailed] = useState(false);

  const sourceId = ids.length === 1 ? ids[0] : '';
  const source = sourceId ? doc.layers[sourceId] : undefined;
  const targets = useMemo<Target[]>(() => {
    if (!source || source.kind !== 'image' || !source.assetId) return [];
    const found: Target[] = [];
    doc.slideOrder.forEach((slideId, index) => {
      for (const id of doc.slides[slideId].layerOrder) {
        const layer = doc.layers[id];
        if (layer?.kind !== 'image' || !canSwapPhotoFrames(doc, source.id, id)) continue;
        found.push({ id, label: `Slide ${index + 1} · ${layer.name}${layer.assetId ? '' : ' (empty)'}`, empty: !layer.assetId });
      }
    });
    return found;
  }, [doc, source]);

  const run = (from: string, to: string) => {
    const ok = swapPhotos(from, to);
    setFailed(!ok);
    if (ok) setTargetId('');
  };

  if (ids.length === 2) {
    const [a, b] = ids;
    const first = doc.layers[a], second = doc.layers[b];
    if (first?.kind !== 'image' || second?.kind !== 'image') return null;
    const ready = canSwapPhotoFrames(doc, a, b);
    const moving = first.assetId === null || second.assetId === null;
    return (
      <Section title={moving ? 'Move photo' : 'Swap photos'}>
        <button type="button" className="btn btn-secondary btn-sm w-full" disabled={!ready} onClick={() => run(a, b)}>
          {moving ? <MoveRight size={13} className="shrink-0" aria-hidden /> : <ArrowLeftRight size={13} className="shrink-0" aria-hidden />}
          {moving ? 'Move photo' : 'Swap photos'}
        </button>
        <p className="text-[11px] leading-snug text-ink-faint">
          {ready ? moving ? 'The photo moves to the empty frame. Frame sizes and styling stay put.' : 'Each photo takes the other’s place. Frame sizes and styling stay put.' : 'Choose two photo frames with at least one photo and different contents.'}
        </p>
        {failed && <p role="status" className="text-[11px] leading-snug text-red-300">These frames can’t swap right now.</p>}
      </Section>
    );
  }

  if (!source || ids.length !== 1 || !targets.length) return null;
  const target = targets.find((t) => t.id === targetId);
  return (
    <Section title="Move or swap">
      <select
        className="input"
        value={target?.id ?? ''}
        aria-label="Other photo frame"
        onChange={(e) => { setTargetId(e.target.value); setFailed(false); }}
      >
        <option value="">Choose a frame…</option>
        {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <button type="button" className="btn btn-secondary btn-sm w-full" disabled={!target} onClick={() => target && run(source.id, target.id)}>
        {target?.empty ? <MoveRight size={13} className="shrink-0" aria-hidden /> : <ArrowLeftRight size={13} className="shrink-0" aria-hidden />}
        {target?.empty ? 'Move photo' : 'Swap photos'}
      </button>
      <p className="text-[11px] leading-snug text-ink-faint">
        {target?.empty ? 'The photo moves to the empty frame; this one becomes empty.' : 'Pick another frame to trade photos with, even on a different slide.'}
      </p>
      {failed && <p role="status" className="text-[11px] leading-snug text-red-300">That frame isn’t available any more.</p>}
    </Section>
  );
}
