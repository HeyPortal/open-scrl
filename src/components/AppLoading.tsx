import { AppLogo } from './AppLogo';

/** Matches the initial HTML splash; critical styles live inline in index.html. */
export function AppLoading({ label = 'Loading Open-SCRL' }: { label?: string }) {
  return <div className="app-loading" role="status" aria-label={label}>
    <AppLogo className="app-loading-logo" size={48} />
    <p className="app-loading-wordmark">Open-SCRL</p>
    <div className="app-loading-status"><span className="app-loading-spinner" aria-hidden /><span>{label}…</span></div>
  </div>;
}
