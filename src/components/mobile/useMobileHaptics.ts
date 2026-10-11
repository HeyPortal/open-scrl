import { useEffect } from 'react';
import { useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import { useExport } from '@/editor/exportStore';
import { mobileHaptic, startMobileHaptics, type MobileFeedback } from '@/lib/mobileHaptics';

// Only discrete commands: typing, continuous sliders, autosave and drag previews stay quiet.
const commandFeedback: Record<string, MobileFeedback> = {
  'Add slide': 'confirm', 'Duplicate slide': 'confirm', 'Move slide': 'confirm', 'Delete slide': 'delete',
  'Add photo': 'confirm', 'Replace photo': 'confirm', 'Fill photo frame': 'confirm', 'Place photos': 'confirm',
  'Clear photo': 'delete', 'Shuffle photos': 'confirm', 'Swap photos': 'confirm', 'Move photo': 'confirm',
  'Add text': 'confirm', 'Add shape': 'confirm', 'Apply grid': 'confirm',
  'Duplicate layers': 'confirm', 'Delete layers': 'delete', 'Group layers': 'confirm', 'Ungroup layers': 'confirm',
  'Align layers': 'confirm', 'Distribute layers': 'confirm', 'Reorder layers': 'confirm',
  'Toggle layer visibility': 'confirm', 'Toggle layer lock': 'confirm',
  'Change format': 'confirm', 'Change all backgrounds': 'confirm',
  'Spread panorama across slides': 'confirm', 'Add media as slides': 'confirm',
  'Apply grid spacing to all slides': 'confirm', 'Re-attach grid slots': 'confirm', 'Link grid spacing': 'confirm',
};

/** Observe successful changes so shared panels also get phone feedback, without changing the document model. */
export function useMobileHaptics() {
  useEffect(() => {
    const stop = startMobileHaptics();
    const document = useDocumentStore.subscribe((next, previous) => {
      if (next.doc.id !== previous.doc.id || next.past === previous.past || next.transaction) return;
      if ((next.future.length > previous.future.length && next.future[0] === previous.past.at(-1))
        || (previous.future.length > next.future.length && next.past.at(-1) === previous.future[0])) {
        mobileHaptic('history');
        return;
      }
      const entry = next.past.at(-1);
      if (!entry || entry === previous.past.at(-1)) return;
      const cue = commandFeedback[entry.label];
      if (cue) mobileHaptic(cue);
      else if (entry.label === 'Edit layers' && entry.patches.some((patch) => {
        if (patch.path[0] !== 'layers') return false;
        const id = String(patch.path[1]), before = previous.doc.layers[id], after = next.doc.layers[id];
        return before && after && (before.locked !== after.locked || before.visible !== after.visible);
      })) mobileHaptic('confirm');
    });
    const selection = useEditorSession.subscribe((next, previous) => {
      const layersChanged = next.selectedLayerIds.join(',') !== previous.selectedLayerIds.join(',');
      const slides = useDocumentStore.getState().doc.slideOrder;
      const slideChanged = next.selectedSlideId !== previous.selectedSlideId && slides.includes(previous.selectedSlideId) && slides.includes(next.selectedSlideId);
      if ((layersChanged && next.selectedLayerIds.length > 0) || (slideChanged && !next.selectedLayerIds.length)) mobileHaptic('selection');
    });
    const exporting = useExport.subscribe((next, previous) => {
      if (next.exporting && !previous.exporting) mobileHaptic('confirm');
      if (previous.exporting && !next.exporting) {
        if (next.error) mobileHaptic('error');
        else if (next.outcome === 'complete') mobileHaptic('success');
      }
    });
    return () => { document(); selection(); exporting(); stop(); };
  }, []);
}
