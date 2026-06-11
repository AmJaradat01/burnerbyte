// Adds jest-dom matchers (toBeInTheDocument, toHaveAttribute, …) to Vitest's
// expect, and runs before every test file (see vitest.config.mts setupFiles).
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom's localStorage can be a non-functional stub under an opaque origin;
// provide a complete in-memory implementation so storage-using code is testable.
if (!window.localStorage || typeof window.localStorage.clear !== "function") {
  const store = new Map<string, string>();
  const ls: Storage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", { value: ls, writable: true, configurable: true });
}

// jsdom doesn't implement matchMedia; components that read prefers-reduced-motion
// need a stub.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
