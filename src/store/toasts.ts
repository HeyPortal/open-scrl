import { create } from 'zustand';
import { id } from '@/lib/nano';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, kind?: ToastKind) => void;
  removeToast: (toastId: string) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, kind = 'info') => {
    const toast: Toast = { id: id(), message, kind };
    set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }));
    window.setTimeout(() => {
      useToasts.getState().removeToast(toast.id);
    }, 3200);
  },

  removeToast: (toastId) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== toastId) }));
  },
}));
