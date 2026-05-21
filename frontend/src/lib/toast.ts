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

// Concurrent-approve / send / discard races surface as 400 "not in PENDING
// status" from the backend. The user's intent ("resolve this draft") is
// already satisfied by whichever request landed first, so we surface those as
// a softer "already resolved" success rather than a scary error toast.
export function isAlreadyResolvedError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (err.response?.status !== 400) return false;
  const data = err.response?.data as
    | { error?: string; message?: string }
    | undefined;
  const msg = (data?.error ?? data?.message ?? '').toLowerCase();
  return msg.includes('not in pending');
}
