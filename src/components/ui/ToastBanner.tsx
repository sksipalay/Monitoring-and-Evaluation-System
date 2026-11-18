import { CheckCircle2, X, XCircle } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error';
  message: string;
}

interface ToastBannerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastBanner({ toasts, onDismiss }: ToastBannerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-md no-print">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`animate-fade-in flex items-start gap-3 rounded-xl border px-4 py-3.5 shadow-lg ${
            t.type === 'success'
              ? 'border-emerald-200 dark:border-emerald-800/80 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
              : 'border-red-200 dark:border-red-800/80 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
          }`}
        >
          {t.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          )}
          <p className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">{t.message}</p>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
