// Walks an Express 4 app's router stack and returns every concrete route with
// the names of the guard middleware that run before its handler (mount-level
// `app.use(path, guard, router)`, router-level `router.use(guard)`, and
// per-route `router.get(path, guard, handler)`).
import type { Express } from 'express';

export interface RouteEntry {
  method: string;
  path: string;
  guards: string[];
}

interface Layer {
  name: string;
  regexp: RegExp & { fast_slash?: boolean };
  handle: { name: string; stack?: Layer[] } & ((...args: unknown[]) => unknown);
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
}

const GUARD_NAMES = new Set(['requireAuth', 'requireAdmin']);

function mountPath(layer: Layer): string {
  if (layer.regexp.fast_slash) return '';
  return layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/');
}

function walk(stack: Layer[], prefix: string, inherited: string[], out: RouteEntry[]): void {
  // Guards registered via router.use(guard) / app.use(path, guard) apply to
  // every later layer with the same mount path.
  const pathGuards = new Map<string, string[]>();
  for (const layer of stack) {
    if (layer.route) {
      const own = layer.route.stack.map((l) => l.handle.name).filter((n) => GUARD_NAMES.has(n));
      const mounted = pathGuards.get('') ?? [];
      for (const method of Object.keys(layer.route.methods)) {
        out.push({
          method: method.toUpperCase(),
          path: prefix + layer.route.path,
          guards: [...inherited, ...mounted, ...own],
        });
      }
      continue;
    }
    const mp = mountPath(layer);
    if (layer.name === 'router' && layer.handle.stack) {
      const guards = [...(pathGuards.get(mp) ?? [])];
      if (mp !== '') guards.unshift(...(pathGuards.get('') ?? []));
      walk(layer.handle.stack, prefix + mp, [...inherited, ...guards], out);
      continue;
    }
    if (GUARD_NAMES.has(layer.handle.name)) {
      pathGuards.set(mp, [...(pathGuards.get(mp) ?? []), layer.handle.name]);
    }
  }
}

export function listRoutes(app: Express): RouteEntry[] {
  const out: RouteEntry[] = [];
  const root = (app as unknown as { _router: { stack: Layer[] } })._router.stack;
  walk(root, '', [], out);
  return out;
}
