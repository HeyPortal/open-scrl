import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts } from '@/store/toasts';

const kindStyle = {
  info: { Icon: Info, className: 'text-accent' },
  success: { Icon: CheckCircle2, className: 'text-emerald-400' },
  warning: { Icon: AlertTriangle, className: 'text-amber-400' },
  error: { Icon: XCircle, className: 'text-red-400' },
};

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const removeToast = useToasts((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-28 right-4 z-[1000] flex w-80 flex-col gap-2">
      {toasts.map((toast) => {
        const { Icon, className } = kindStyle[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line-strong bg-bg-overlay px-3 py-2.5 text-xs text-ink shadow-lift"
          >
            <Icon size={17} className={`mt-px shrink-0 ${className}`} aria-hidden />
            <div className="flex-1 leading-snug">
              {toast.message}
              {toast.action && (
                <button
                  className="mt-1.5 block font-semibold text-accent hover:text-accent-hover"
                  onClick={() => { removeToast(toast.id); toast.action!.run(); }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button className="text-ink-faint hover:text-ink" onClick={() => removeToast(toast.id)} title="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
