import { useEffect, useState, useSyncExternalStore } from 'react';
import { useDocumentStore } from '@/editor/documentStore';
import { editorActivity } from '@/editor/activity';
import { UpdateController } from './updateController';

type UpdateEvent = 'available' | 'activated';
let observer: ((event: UpdateEvent) => void) | undefined;
let available = false;
let activated = false;
let registration: Promise<(reloadPage?: boolean) => Promise<void>> | undefined;

function observeUpdates(next: (event: UpdateEvent) => void): () => void {
  observer = next;
  if (available) next('available');
  if (activated) next('activated');
  if (!registration) {
    const notify = (event: UpdateEvent) => {
      if (event === 'available') { available = true; activated = false; }
      else activated = true;
      observer?.(event);
    };
    registration = import('virtual:pwa-register').then(({ registerSW }) => registerSW({
      onNeedRefresh: () => notify('available'),
      onNeedReload: () => notify('activated'),
      onRegisterError: (error) => console.warn('Could not check for app updates.', error),
    })).catch((error: unknown) => {
      console.warn('Could not load app update registration.', error);
      return async () => undefined;
    });
    // Workbox's controlling listener is installed after its waiting event.
    // Also catch a different tab activating before we receive that event.
    if ('serviceWorker' in navigator) {
      let previous = navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        const current = navigator.serviceWorker.controller;
        if (previous && current !== previous) notify('activated');
        previous = current;
      });
    }
  }
  return () => { if (observer === next) observer = undefined; };
}

function subscribeEditor(listener: () => void): () => void {
  const unsubscribeDocument = useDocumentStore.subscribe((state, previous) => {
    if (state.doc !== previous.doc || state.activeProjectId !== previous.activeProjectId || state.ready !== previous.ready || state.transaction !== previous.transaction || state.saveError !== previous.saveError) listener();
  });
  const unsubscribeActivity = editorActivity.subscribe(listener);
  return () => { unsubscribeDocument(); unsubscribeActivity(); };
}

export function PwaUpdatePrompt({ flush }: { flush: () => Promise<void> }) {
  const [controller] = useState(() => new UpdateController({
    snapshot: () => {
      const state = useDocumentStore.getState();
      return { ready: state.ready, busy: editorActivity.getSnapshot() > 0 || state.transaction !== null, version: `${state.activeProjectId}:${state.doc.revision}`, saveError: state.saveError };
    },
    subscribe: subscribeEditor,
    flush,
    activate: async () => { const update = await registration; await update?.(); },
    reload: () => window.location.reload(),
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const stop = controller.start();
    const unobserve = observeUpdates((event) => event === 'available' ? controller.notifyUpdate() : controller.notifyActivated());
    return () => { unobserve(); stop(); };
  }, [controller]);
  if (state.status === 'idle' || state.status === 'waiting') return null;
  return <div role="status" className="fixed bottom-5 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-bg-panel p-3 text-xs text-ink shadow-lift">
    <span>{state.status === 'error' ? state.error : state.status === 'updating' ? 'Finishing your work before updating…' : 'A new version of Open-SCRL is ready.'}</span>
    <button className="btn btn-sm btn-primary shrink-0" disabled={state.status === 'updating'} onClick={() => controller.requestUpdate()}>{state.status === 'updating' ? 'Updating…' : state.status === 'error' ? 'Retry update' : 'Reload to update'}</button>
    {state.status !== 'updating' && <button className="btn btn-sm shrink-0" onClick={() => controller.dismiss()}>Later</button>}
  </div>;
}
