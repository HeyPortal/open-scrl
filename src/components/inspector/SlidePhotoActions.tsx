import { Shuffle } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { getSlideLayers } from '@/core/document/selectors';
import { canShufflePhotoFrames } from '@/core/document/photos';
import { Section } from '../ui';

/** Photo actions for a slide's inspector: swap which photo sits in which frame. */
export function SlidePhotoActions({ slideId }: { slideId: string }) {
  const frames = useEditor((s) => getSlideLayers(s.doc, slideId).filter((l) => l.kind === 'image' && l.visible).length);
  const canShuffle = useEditor((s) => canShufflePhotoFrames(s.doc, slideId));
  const shufflePhotos = useEditor((s) => s.shufflePhotos);
  if (frames === 0) return null;

  return (
    <Section title="Photos">
      <button type="button" className="btn btn-secondary btn-sm w-full" disabled={!canShuffle} onClick={() => shufflePhotos(slideId)}>
        <Shuffle size={14} aria-hidden /> Shuffle photos
      </button>
      <p className="text-[11px] leading-snug text-ink-faint">
        {canShuffle ? 'Photos trade places while every frame stays where it is.' : 'Add at least two different photos to this slide to shuffle them.'}
      </p>
    </Section>
  );
}
