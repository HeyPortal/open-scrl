import { useRef } from 'react';
import { useEditor } from '@/store/editor';
import type { Gesture } from '../ui';

/** Groups the edits of one slider, scrub or handle drag into a single undo step. */
export function useEditGesture(label: string, mergeKey?: string): Gesture {
  const beginTransaction = useEditor((s) => s.beginTransaction);
  const commitTransaction = useEditor((s) => s.commitTransaction);
  const cancelTransaction = useEditor((s) => s.cancelTransaction);
  const transaction = useRef<string | null>(null);
  return {
    begin: () => { if (!transaction.current) transaction.current = beginTransaction(label, mergeKey); },
    end: () => { if (transaction.current) commitTransaction(transaction.current); transaction.current = null; },
    cancel: () => { if (transaction.current) cancelTransaction(transaction.current); transaction.current = null; },
  };
}

export function useLayerGesture(layerId: string, label: string): Gesture {
  return useEditGesture(label, `gesture:${layerId}:${label}`);
}
