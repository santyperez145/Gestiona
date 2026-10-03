import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const FAST_XML_DENO_IMPORT = "npm:fast-xml-parser@5.11.2";

/**
 * Edge Functions keep an explicit, versioned `npm:` import that Deno can deploy.
 * Vite does not interpret that Deno specifier, so tests resolve this one audited
 * package during the pre-resolution phase. Keeping the bridge exact avoids
 * turning arbitrary Edge imports into local dependencies.
 */
function resolveDenoTestImports(): Plugin {
  return {
    name: "resolve-deno-test-imports",
    enforce: "pre",
    async resolveId(source, importer) {
      if (source !== FAST_XML_DENO_IMPORT) return null;
      return this.resolve("fast-xml-parser", importer, { skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [resolveDenoTestImports(), react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Varias guardas recorren cientos de fuentes/migraciones. Vitest usaba
    // todos los cores y cada worker repetía I/O; bajo carga de esta PC los
    // escaneos válidos superaban 5 s y daban rojos intermitentes. Cuatro
    // workers mantienen paralelismo sin convertir el disco en el cuello.
    maxWorkers: 4,
    // El pool `threads` de vitest 5 rompe cada suite con
    // «Cannot read properties of undefined (reading 'config')» al correr bajo
    // Node 24 en Windows (el runner global no llega al worker). vmThreads
    // aísla cada archivo en su propio contexto de VM dentro de un worker real:
    // mismo aislamiento por archivo, entorno jsdom reutilizado por worker.
    pool: "vmThreads",
    // Env dummy para que el cliente de Supabase (createClient) se instancie
    // al importar páginas en los smoke tests, sin apuntar a nada real.
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
