import { toast as sonner } from 'sonner';
import axios from 'axios';

const ERROR_DURATION = 6000;
const SUCCESS_DURATION = 4000;

export function toastSuccess(
  message: string,
  description?: string,
  action?: { label: string; onClick: () => void }
) {
  return sonner.success(message, {
    description,
    duration: action ? ERROR_DURATION : SUCCESS_DURATION,
    ...(action && { action }),
  });
}

export function toastWarning(message: string, description?: string) {
  return sonner.warning(message, {
    description,
    duration: ERROR_DURATION,
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
  // 409 = the draft changed state under us (double approve/send/discard);
  // 400 kept for older backends.
  const status = err.response?.status;
  if (status === 409) return true;
  if (status !== 400) return false;
  const data = err.response?.data as
    | { error?: string; message?: string }
    | undefined;
  const msg = (data?.error ?? data?.message ?? '').toLowerCase();
  return msg.includes('not in pending');
}
