// Adds jest-dom matchers (toBeInTheDocument, toHaveAttribute, …) to Vitest's
// expect, and runs before every test file (see vitest.config.mts setupFiles).
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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
