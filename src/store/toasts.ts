import { create } from 'zustand';
import { id } from '@/lib/nano';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  removeToast: (toastId: string) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, kind = 'info', action) => {
    const toast: Toast = { id: id(), message, kind, action };
    set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }));
    // Toasts with a button stay long enough to read and reach.
    window.setTimeout(() => {
      useToasts.getState().removeToast(toast.id);
    }, action ? 8000 : 3200);
  },

  removeToast: (toastId) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== toastId) }));
  },
}));
