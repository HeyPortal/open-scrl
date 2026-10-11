import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts } from '@/store/toasts';
import { useMobileLayout } from '@/app/useMobileLayout';

const kindStyle = {
  info: { Icon: Info, className: 'text-ink-dim' },
  success: { Icon: CheckCircle2, className: 'text-success' },
  warning: { Icon: AlertTriangle, className: 'text-warning' },
  error: { Icon: XCircle, className: 'text-danger-icon' },
};

/** `inline` renders the stack in flow (App places it under the phone's banners); otherwise it floats bottom right. */
export function ToastViewport({ inline = false }: { inline?: boolean }) {
  const toasts = useToasts((s) => s.toasts);
  const removeToast = useToasts((s) => s.removeToast);
  const mobile = useMobileLayout();

  if (toasts.length === 0) return null;

  return (
    <div
      className={inline
        // Phones: under the top bar and any banners, full width, clear of the sheet and dock at the bottom.
        ? 'pointer-events-none flex flex-col gap-2'
        // Desktop: above the timeline so the zoom and slide export controls stay reachable.
        : 'pointer-events-none fixed bottom-[136px] right-4 z-[1000] flex w-[340px] flex-col gap-2'}
    >
      {toasts.map((toast) => {
        const { Icon, className } = kindStyle[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`studio-toast pointer-events-auto ${mobile ? 'studio-toast-touch' : ''}`}
          >
            <Icon size={mobile ? 18 : 16} className={`studio-toast-icon ${className}`} aria-hidden />
            <div className="min-w-0 flex-1">
              {toast.message}
              {toast.action && (
                <button className="studio-toast-action" onClick={() => { removeToast(toast.id); toast.action!.run(); }}>
                  {toast.action.label}
                </button>
              )}
            </div>
            <button className="studio-toast-close" onClick={() => removeToast(toast.id)} title="Dismiss" aria-label="Dismiss">
              <X size={mobile ? 16 : 14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
