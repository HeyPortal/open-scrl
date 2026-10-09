import { useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import type { Gesture } from '../ui';

/** Groups the edits of one slider, scrub or handle drag into a single undo step. */
export function useEditGesture(label: string, mergeKey?: string): Gesture {
  const beginTransaction = useEditor((s) => s.beginTransaction);
  const commitTransaction = useEditor((s) => s.commitTransaction);
  const cancelTransaction = useEditor((s) => s.cancelTransaction);
  const transaction = useRef<string | null>(null);
  // The control can unmount mid-gesture (on a phone the inspector sheet closes when another finger
  // clears the selection). Commit what was done so the open transaction doesn't swallow later edits.
  useEffect(() => () => {
    if (transaction.current) commitTransaction(transaction.current);
    transaction.current = null;
  }, [commitTransaction]);
  return {
    begin: () => { if (!transaction.current) transaction.current = beginTransaction(label, mergeKey); },
    end: () => { if (transaction.current) commitTransaction(transaction.current); transaction.current = null; },
    cancel: () => { if (transaction.current) cancelTransaction(transaction.current); transaction.current = null; },
  };
}

export function useLayerGesture(layerId: string, label: string): Gesture {
  return useEditGesture(label, `gesture:${layerId}:${label}`);
}
