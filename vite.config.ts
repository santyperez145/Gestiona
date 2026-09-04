import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// Sube source maps a Sentry en el build de producción SOLO si están las
// credenciales configuradas (SENTRY_AUTH_TOKEN + org + project). Sin ellas,
// el plugin no se activa y el build funciona igual — no rompe nada en local/CI.
const sentryEnabled =
  !!process.env.SENTRY_AUTH_TOKEN &&
  !!process.env.SENTRY_ORG &&
  !!process.env.SENTRY_PROJECT;

const esPaquete = (id: string, ...paquetes: string[]) =>
  paquetes.some((paquete) =>
    id.includes(`node_modules/${paquete}/`) ||
    id.includes(`node_modules\\${paquete}\\`),
  );

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      // 📌 `brand/nerqia-mark.png` figura dos veces en el manifiesto —una
      // por acá y otra por `globPatterns`— pero es **la misma URL con la
      // misma revisión**: el navegador la baja una sola vez. Vaciar esta lista
      // no ahorra descargas. `robots.txt` no vive en `public/`: Vercel sirve
      // el archivo estático *antes* del rewrite, y Google nunca vería Sitemap.
      includeAssets: ["brand/nerqia-mark.png"],
      manifest: {
        name: "Nerqia — Sistema de Gestión",
        short_name: "Nerqia",
        description: "Sistema de gestión para tu negocio: ventas, stock, POS, clientes y más.",
        theme_color: "#173aef",
        background_color: "#f8f9fc",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/brand/nerqia-mark.png",
            sizes: "389x389",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        /**
         * ── Lo que NO se precachea ────────────────────────────────────────
         *
         * ⚠️ Medido el 2026-08-28: el precache eran **8,2 MB en 257 entradas**,
         * y el service worker se registra en **toda** página —incluida la
         * tienda pública—. O sea que alguien que entra a mirar un perfume
         * bajaba en segundo plano el panel entero: 87 chunks de páginas que no
         * va a abrir (3 MB) más xlsx, gráficos y PDF (1,3 MB).
         *
         * En Argentina la mayoría del tráfico de ecommerce es mobile y con
         * datos. Eso es plata del comprador, gastada en algo que no va a usar.
         *
         * 📌 Lo que se conserva a propósito, porque el SW sí sirve:
         *   - el **shell** (entry, vendors compartidos, CSS, íconos), para que
         *     la app abra sin conexión;
         *   - **`POSPage`**, que es la razón de ser del PWA: una feria sin
         *     señal tiene que poder vender;
         *   - el runtime caching de la REST y del storage de Supabase, que no
         *     depende del precache y sigue igual.
         *
         * El resto de las páginas se cachea **la primera vez que se abren**,
         * que es como funciona cualquier PWA grande. La única contrapartida:
         * una página que nunca se visitó online no está offline — y eso es
         * cierto para cualquier estrategia que no baje 8 MB por las dudas.
         */
        globIgnores: [
          // Las páginas del panel, salvo el POS.
          "assets/!(POSPage|index|vendor)*-*.js",
          // Vendors que sólo usan pantallas puntuales: reportes, exportaciones.
          "assets/vendor-{xlsx,charts,pdf}-*.js",
        ],
      },
    }),
    // Debe ir al final del array de plugins. Solo se activa con credenciales.
    sentryEnabled &&
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: process.env.VITE_APP_VERSION },
        sourcemaps: {
          // Sube los .map y luego los borra del dist para no exponer el código.
          filesToDeleteAfterUpload: ["./dist/**/*.map"],
        },
      }),
  ].filter(Boolean),
  optimizeDeps: {
    include: ['@zxing/browser', '@zxing/library'],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    // Genera source maps ocultos solo cuando se van a subir a Sentry (el plugin
    // los borra del dist después de subirlos, así el código no queda expuesto).
    sourcemap: sentryEnabled ? "hidden" : false,
    rolldownOptions: {
      output: {
        /**
         * ⚠️ Vite 8 usa Rolldown. Sus grupos incluyen las dependencias de cada
         * paquete recursivamente por default: si `recharts` captura `clsx` o
         * jsPDF captura el helper de preload, el entry termina importando el
         * vendor pesado y el navegador lo baja antes de mostrar una tienda.
         *
         * `includeDependenciesRecursively: false` queda sólo en utilidades y
         * vendors pesados. React, Query, Radix y Supabase conservan su grafo
         * recursivo para no crear ciclos de ejecución entre chunks; PDF,
         * charts y xlsx sólo contienen sus paquetes y se descargan cuando la
         * ruta los pide, no cuando un comprador mira un producto.
         */
        codeSplitting: {
          groups: [
            {
              name: "vendor-utils",
              test: (id: string) =>
                id.includes("vite/preload-helper") ||
                esPaquete(id, "clsx", "tailwind-merge", "class-variance-authority"),
              priority: 100,
              includeDependenciesRecursively: false,
            },
            {
              name: "vendor-react",
              test: (id: string) =>
                esPaquete(id, "react", "react-dom", "react-router", "react-router-dom"),
              priority: 90,
              includeDependenciesRecursively: true,
            },
            {
              name: "vendor-query",
              test: (id: string) => esPaquete(id, "@tanstack/react-query", "@tanstack/query-core"),
              priority: 80,
              includeDependenciesRecursively: true,
            },
            {
              name: "vendor-ui",
              test: (id: string) =>
                esPaquete(id, "@radix-ui/react-dialog", "@radix-ui/react-select",
                  "@radix-ui/react-tabs", "@radix-ui/react-dropdown-menu"),
              priority: 70,
              includeDependenciesRecursively: true,
            },
            {
              name: "vendor-supabase",
              test: (id: string) => esPaquete(id, "@supabase/supabase-js"),
              priority: 60,
              includeDependenciesRecursively: true,
            },
            {
              name: "vendor-pdf",
              test: (id: string) => esPaquete(id, "jspdf", "jspdf-autotable"),
              priority: 50,
              includeDependenciesRecursively: false,
            },
            {
              name: "vendor-charts",
              test: (id: string) => esPaquete(id, "recharts"),
              priority: 40,
              includeDependenciesRecursively: false,
            },
            {
              name: "vendor-xlsx",
              test: (id: string) => esPaquete(id, "xlsx"),
              priority: 30,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
}));
