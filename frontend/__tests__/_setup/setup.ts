import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement Element.scrollIntoView; stub it so components that
// auto-scroll focused rows don't blow up in tests.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {
    /* no-op */
  };
}

// jsdom doesn't implement ResizeObserver. Radix UI's tooltip/dropdown internals
// hold a reference to it after click, surfacing async unhandled errors that
// flip Vitest's exit code even when every test assertion passes.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}
