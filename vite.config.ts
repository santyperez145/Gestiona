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
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-ui": ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tabs", "@radix-ui/react-dropdown-menu"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-pdf": ["jspdf", "jspdf-autotable"],
          "vendor-charts": ["recharts"],
          "vendor-xlsx": ["xlsx"],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
}));
