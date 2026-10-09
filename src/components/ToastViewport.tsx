import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts } from '@/store/toasts';
import { useMobileLayout } from '@/app/useMobileLayout';

const kindStyle = {
  info: { Icon: Info, className: 'text-accent' },
  success: { Icon: CheckCircle2, className: 'text-emerald-400' },
  warning: { Icon: AlertTriangle, className: 'text-amber-400' },
  error: { Icon: XCircle, className: 'text-red-400' },
};

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const removeToast = useToasts((s) => s.removeToast);
  const mobile = useMobileLayout();

  if (toasts.length === 0) return null;

  return (
    <div
      className={mobile
        // Phones: under the top bar, full width, clear of the sheet and dock at the bottom.
        ? 'pointer-events-none fixed inset-x-4 top-[calc(env(safe-area-inset-top)+60px)] z-[1000] flex flex-col gap-2'
        : 'pointer-events-none fixed bottom-28 right-4 z-[1000] flex w-80 flex-col gap-2'}
    >
      {toasts.map((toast) => {
        const { Icon, className } = kindStyle[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-2.5 border border-line-strong bg-bg-overlay text-ink shadow-lift ${mobile ? 'rounded-xl px-3.5 py-3 text-[14px]' : 'rounded-lg px-3 py-2.5 text-xs'}`}
          >
            <Icon size={17} className={`mt-px shrink-0 ${className}`} aria-hidden />
            <div className="flex-1 leading-snug">
              {toast.message}
              {toast.action && (
                <button
                  className={`block font-semibold text-accent hover:text-accent-hover ${mobile ? 'mt-1 py-1.5' : 'mt-1.5'}`}
                  onClick={() => { removeToast(toast.id); toast.action!.run(); }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button className={`text-ink-faint hover:text-ink ${mobile ? '-m-2 p-2' : ''}`} onClick={() => removeToast(toast.id)} title="Dismiss" aria-label="Dismiss">
              <X size={mobile ? 16 : 14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
