import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";

// El entorno jsdom trae un crypto propio sin randomUUID ni subtle. Bajo el
// pool vmThreads el global es la ventana jsdom (no el worker de Node), así que
// el producto —que usa ambas APIs— ve «crypto.randomUUID is not a function».
// Se provee el webcrypto real de Node: mismo motor que en producción.
const g = globalThis as unknown as { crypto?: Crypto };
if (!g.crypto?.randomUUID || !g.crypto?.subtle) {
  Object.defineProperty(g, "crypto", {
    value: webcrypto as unknown as Crypto,
    configurable: true,
    writable: true,
  });
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
