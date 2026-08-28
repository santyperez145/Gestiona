import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// Sube source maps a Sentry en el build de producción SOLO si están las
// credenciales configuradas (SENTRY_AUTH_TOKEN + org + project). Sin ellas,
// el plugin no se activa y el build funciona igual — no rompe nada en local/CI.
const sentryEnabled =
  !!process.env.SENTRY_AUTH_TOKEN &&
  !!process.env.SENTRY_ORG &&
  !!process.env.SENTRY_PROJECT;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      // 📌 `brand/gestiona-mark.png` figura dos veces en el manifiesto —una
      // por acá y otra por `globPatterns`— pero es **la misma URL con la
      // misma revisión**: el navegador la baja una sola vez. Lo duplicado es
      // el número que reporta el plugin, no la descarga. Vaciar esta lista
      // sólo saca `robots.txt` del precache y no ahorra nada.
      includeAssets: ["brand/gestiona-mark.png", "robots.txt"],
      manifest: {
        name: "Gestiona — Sistema de Gestión",
        short_name: "Gestiona",
        description: "Sistema de gestión para tu negocio: ventas, stock, POS, clientes y más.",
        theme_color: "#173aef",
        background_color: "#f8f9fc",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/brand/gestiona-mark.png",
            sizes: "1254x1254",
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
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    // Genera source maps ocultos solo cuando se van a subir a Sentry (el plugin
    // los borra del dist después de subirlos, así el código no queda expuesto).
    sourcemap: sentryEnabled ? "hidden" : false,
    rollupOptions: {
      output: {
        /**
         * ⚠️ Función, no objeto — y la diferencia se mide en KB que baja un
         * comprador.
         *
         * Con la forma de objeto, Rollup mete los helpers compartidos —entre
         * ellos el `__vitePreload` del propio Vite, que no vive en
         * `node_modules`— dentro del primer vendor que los necesita. El chunk
         * de entrada quedaba importando **un solo símbolo** de `vendor-pdf` y
         * **uno** de `vendor-charts`, y con eso `index.html` emitía
         * `modulepreload` de los dos.
         *
         * Medido en la tienda real el 2026-08-28: la primera carga eran 636 KB
         * comprimidos, y **248 KB (39%) eran generación de PDF y gráficos** —
         * que un comprador de perfumes no usa nunca.
         *
         * 📌 Con la forma de función sólo se mueve lo que está en
         * `node_modules`: los helpers de Vite se quedan en el entry y los
         * vendors pesados vuelven a cargarse recién cuando una página los pide.
         */
        manualChunks(id: string) {
          /**
           * ⚠️ El helper de `import()` de Vite va primero, y **antes** del
           * filtro de `node_modules`, porque es un módulo virtual
           * (`\0vite/preload-helper`) que no vive ahí.
           *
           * Dejarlo a criterio de Rollup lo mandaba adentro de `vendor-pdf`, y
           * el chunk de entrada terminaba importando los 138 KB de jsPDF por
           * una función de veinte líneas que sirve para cargar cualquier página.
           *
           * 📌 Verificado en el bundle: el símbolo que el entry tomaba de
           * `vendor-pdf` era exactamente `__vitePreload`.
           */
          if (id.includes("vite/preload-helper")) return "vendor-utils";

          if (!id.includes("node_modules")) return;
          const en = (...paquetes: string[]) =>
            paquetes.some(p =>
              id.includes(`node_modules/${p}/`) || id.includes(`node_modules\\${p}\\`));

          /**
           * ⚠️ Primero las utilidades chicas y compartidas. Sin esta línea,
           * Rollup mete `clsx` dentro de `vendor-charts` —porque recharts la
           * usa— y el chunk de entrada, que llama a `cn()`, termina importando
           * los 110 KB de gráficos por una función de 8 líneas.
           *
           * 📌 Verificado en el bundle: el símbolo que el entry tomaba de
           * `vendor-charts` era exactamente `clsx`.
           */
          if (en("clsx", "tailwind-merge", "class-variance-authority")) return "vendor-utils";

          if (en("react", "react-dom", "react-router-dom")) return "vendor-react";
          if (en("@tanstack/react-query")) return "vendor-query";
          if (en("@radix-ui/react-dialog", "@radix-ui/react-select",
                 "@radix-ui/react-tabs", "@radix-ui/react-dropdown-menu")) return "vendor-ui";
          if (en("@supabase/supabase-js")) return "vendor-supabase";
          if (en("jspdf", "jspdf-autotable")) return "vendor-pdf";
          if (en("recharts")) return "vendor-charts";
          if (en("xlsx")) return "vendor-xlsx";
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
}));
