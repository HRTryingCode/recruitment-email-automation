import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement Element.scrollIntoView; stub it so components that
// auto-scroll focused rows don't blow up in tests.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {
    /* no-op */
  };
}
