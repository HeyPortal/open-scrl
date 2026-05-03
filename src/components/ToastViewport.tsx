import { X } from 'lucide-react';
import { useToasts } from '@/store/toasts';

const kindClass = {
  info: 'border-line',
  success: 'border-emerald-500/60',
  warning: 'border-amber-400/70',
  error: 'border-red-500/70',
};

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const removeToast = useToasts((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 bottom-28 z-[1000] flex w-80 flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-lg border ${kindClass[toast.kind]} bg-bg-rail/95 px-3 py-2 text-sm text-ink shadow-2xl backdrop-blur`}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 leading-snug">{toast.message}</div>
            <button
              className="text-ink-faint hover:text-ink"
              onClick={() => removeToast(toast.id)}
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
