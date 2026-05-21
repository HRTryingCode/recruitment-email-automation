import { toast as sonner } from 'sonner';
import axios from 'axios';

const ERROR_DURATION = 6000;
const SUCCESS_DURATION = 4000;

export function toastSuccess(message: string, description?: string) {
  return sonner.success(message, {
    description,
    duration: SUCCESS_DURATION,
  });
}

export function toastError(message: string, description?: string) {
  return sonner.error(message, {
    description,
    duration: ERROR_DURATION,
  });
}

export function toastLoading(message: string): string | number {
  return sonner.loading(message);
}

export function dismissToast(id: string | number) {
  sonner.dismiss(id);
}

export function extractApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: string; message?: string }
      | undefined;
    return data?.error ?? data?.message ?? err.message ?? fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
