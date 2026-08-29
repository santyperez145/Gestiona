/**
 * Configuración de los tests de punta a punta.
 *
 * Antes esto importaba `lovable-agent-playwright-config`, un paquete que **no
 * está instalado**: Playwright fallaba al arrancar, y por eso el repo tenía la
 * dependencia, la config y **cero specs**. El E2E estaba andamiado y nunca
 * había corrido.
 *
 * Los tests corren contra el bundle de producción servido en local, no contra
 * Vercel: hasta que no se pushea, el sitio publicado tiene el código viejo. Y leen la base de
 * producción, que es la única que hay — por eso los specs son **de sólo
 * lectura**. Si alguno necesita escribir, va con datos `ZZ` y limpieza, como
 * los bloques SQL de verificación.
 */
import { defineConfig, devices } from "@playwright/test";

// El .env del proyecto alimenta al setup de sesión: de ahí salen la URL y la
// clave anónima, que son públicas. Las credenciales del usuario de prueba van
// aparte, en el entorno, y nunca en un archivo del repo.
import { config as cargarEnv } from "dotenv";
cargarEnv({ quiet: true });

// Relativa a la raíz del proyecto: `__dirname` no existe en módulos ES.
const ARCHIVO_SESION = "e2e/.auth/usuario.json";

const PORT = Number.parseInt(process.env.E2E_PORT ?? "4173", 10);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65_535) {
  throw new Error("E2E_PORT debe ser un puerto válido entre 1024 y 65535");
}
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const reuseExistingServer = process.env.E2E_REUSE_SERVER === "true";

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
    // La tienda es pública: no necesita sesión.
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/panel.spec.ts",
    },
    // El comprador argentino promedio entra desde el teléfono; los desbordes
    // de 375px son la clase de bug que sólo se ve ahí.
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      testIgnore: "**/panel.spec.ts",
    },

    // El panel sí. La sesión se obtiene una vez y se reusa.
    { name: "setup", testMatch: "**/auth.setup.ts" },
    {
      name: "panel",
      testMatch: "**/panel.spec.ts",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: ARCHIVO_SESION },
    },
  ],

  // El puerto es estricto y no se reusa por defecto. Antes Playwright aceptaba
  // cualquier proceso que escuchara en 8080 y llegó a ejecutar los specs contra
  // otra aplicación local: un falso resultado más peligroso que un test rojo.
  // El opt-in local sólo se usa cuando quien corre la suite sabe qué servidor
  // está escuchando en E2E_PORT.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    // El dev server transforma módulos en la primera visita. Con cuatro
    // browsers simultáneos una carga llegó a 31 s y agotó el timeout aunque el
    // retry tardó 3 s. El bundle de producción es lo que realmente se deploya,
    // elimina esa carrera y además hace que un error de build bloquee el E2E.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer,
    // El bundle + PWA tarda más bajo carga en Windows que el tiempo de una
    // visita; este margen evita convertir un build lento en un falso rojo.
    timeout: 180_000,
  },
});
