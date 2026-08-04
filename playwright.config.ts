/**
 * Configuración de los tests de punta a punta.
 *
 * Antes esto importaba `lovable-agent-playwright-config`, un paquete que **no
 * está instalado**: Playwright fallaba al arrancar, y por eso el repo tenía la
 * dependencia, la config y **cero specs**. El E2E estaba andamiado y nunca
 * había corrido.
 *
 * Los tests corren contra el dev server local, no contra Vercel: hasta que no
 * se pushea, el sitio publicado tiene el código viejo. Y leen la base de
 * producción, que es la única que hay — por eso los specs son **de sólo
 * lectura**. Si alguno necesita escribir, va con datos `ZZ` y limpieza, como
 * los bloques SQL de verificación.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = 8080;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Vitest se queda con `src/**`; acá no se cruzan.
  testMatch: "**/*.spec.ts",

  // En CI no se reintenta para que un test inestable se note; local sí, porque
  // el primer arranque del dev server a veces tarda más que el timeout.
  retries: process.env.CI ? 0 : 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-AR",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // El comprador argentino promedio entra desde el teléfono; los desbordes
    // de 375px son la clase de bug que sólo se ve ahí.
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],

  // Reusa el server si ya está levantado: en desarrollo uno lo tiene abierto.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run dev",
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
