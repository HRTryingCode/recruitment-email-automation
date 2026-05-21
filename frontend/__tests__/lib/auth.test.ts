import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearToken,
  clearUser,
  getToken,
  getUser,
  setToken,
  setUser,
} from '../../src/lib/auth';

function createMockStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      store = {};
    },
    getItem: (key: string) => (key in store ? store[key] : null),
    key: (index: number) => Object.keys(store)[index] ?? null,
    removeItem: (key: string) => {
      delete store[key];
    },
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
  };
}

describe('lib/auth', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMockStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('token helpers', () => {
    it('setToken then getToken returns the stored value', () => {
      setToken('foo');
      expect(getToken()).toBe('foo');
    });

    it('clearToken removes the stored value', () => {
      setToken('foo');
      clearToken();
      expect(getToken()).toBeNull();
    });

    it('getToken returns null when nothing is stored', () => {
      expect(getToken()).toBeNull();
    });
  });

  describe('user helpers', () => {
    it('setUser then getUser returns a matching object', () => {
      const user = { id: 'u_123', email: 'alice@example.com' };
      setUser(user);
      expect(getUser()).toEqual(user);
    });

    it('setUser preserves optional fields', () => {
      const user = { id: 'u_123', email: 'alice@example.com', name: 'Alice' };
      setUser(user);
      expect(getUser()).toEqual(user);
    });

    it('clearUser removes the stored user', () => {
      setUser({ id: 'u_1', email: 'a@b.com' });
      clearUser();
      expect(getUser()).toBeNull();
    });

    it('returns null and does not throw when stored value is corrupt JSON', () => {
      localStorage.setItem('auth_user', '{not json');
      expect(() => getUser()).not.toThrow();
      expect(getUser()).toBeNull();
    });
  });

  describe('localStorage unavailable', () => {
    it('getToken returns null when localStorage throws', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('storage disabled');
        },
        setItem: () => {
          throw new Error('storage disabled');
        },
        removeItem: () => {
          throw new Error('storage disabled');
        },
      } as unknown as Storage);

      expect(getToken()).toBeNull();
      expect(() => setToken('x')).not.toThrow();
      expect(() => clearToken()).not.toThrow();
    });
  });
});
