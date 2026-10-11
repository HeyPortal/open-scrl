import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
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

/** `mobile` lifts the prompt above the editor's tool dock, which would otherwise cover it. */
export function PwaUpdatePrompt({ flush, mobile = false }: { flush: () => Promise<void>; mobile?: boolean }) {
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
  const updating = state.status === 'updating';
  const message = state.status === 'error' ? state.error : updating ? 'Finishing your work before updating…' : 'A new version of Open-SCRL is ready.';
  const action = mobile ? 'btn h-11 flex-1 rounded-lg px-4 text-sm' : 'btn btn-sm shrink-0';
  // On phones the prompt is a full-width card (message above, 44px actions below) so the copy never
  // squeezes into a narrow column beside the buttons; on desktop it stays one compact row. CSS keeps the
  // phone card above the slide strip and dock, or beside the landscape tool rail.
  return <div role="status" className={`studio-update${mobile ? ' studio-update-mobile' : ''}`}>
    {updating ? <Loader2 size={15} className="studio-update-icon animate-spin" aria-hidden /> : <RefreshCw size={15} className="studio-update-icon" aria-hidden />}
    <span className="min-w-0 break-words">{message}</span>
    <div className={mobile ? 'studio-update-actions flex gap-2' : 'contents'}>
      <button className={`${action} btn-primary`} disabled={updating} onClick={() => controller.requestUpdate()}>{updating ? 'Updating…' : state.status === 'error' ? 'Retry update' : 'Reload to update'}</button>
      {!updating && <button className={`${action} ${mobile ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => controller.dismiss()}>Later</button>}
    </div>
  </div>;
}
