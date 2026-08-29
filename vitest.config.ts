import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
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
    // Env dummy para que el cliente de Supabase (createClient) se instancie
    // al importar páginas en los smoke tests, sin apuntar a nada real.
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
