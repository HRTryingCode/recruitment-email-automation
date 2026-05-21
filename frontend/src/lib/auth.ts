export interface User {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string | null;
}

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

// SSR safety: any environment without `window.localStorage` (Node/Vite SSR,
// TanStack Query prefetch, unit tests under jsdom-less runners) must no-op
// rather than throw a ReferenceError.
function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getToken(): string | null {
  if (!hasStorage()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore quota / unavailable storage
  }
}

export function clearToken(): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getUser(): User | null {
  if (!hasStorage()) return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setUser(user: User): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

export function clearUser(): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}
