export interface User {
  id: string;
  email: string;
  name?: string;
}

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore quota / unavailable storage
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setUser(user: User): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

export function clearUser(): void {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}
