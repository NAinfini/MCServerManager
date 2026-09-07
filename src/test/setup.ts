import "@testing-library/jest-dom/vitest";

// Renderer tests use the document's origin-scoped storage. Node's optional
// file-backed Web Storage must not take ownership of these browser globals.
const browserWindow = (globalThis as unknown as { jsdom: { window: Window } })
  .jsdom.window;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: browserWindow.localStorage,
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: browserWindow.sessionStorage,
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= TestResizeObserver as typeof ResizeObserver;

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
window.confirm = () => true;
