import BrandLogo from "@/components/shared/BrandLogo";

/**
 * El cargador del arranque, uno solo (2026-11-01). Sesión, rol, verificación
 * en dos pasos, el código de la app y la organización mostraban cada uno su
 * propio cargador (distinto tamaño, distinto texto): el dueño lo vio como
 * «cuatro recargas» al entrar. Todas las etapas previas al panel usan éste,
 * igual al que dibuja index.html antes de que arranque JavaScript, así se ve
 * una sola pantalla quieta hasta que aparece el panel.
 */
export default function AppLoader({ label = "Cargando Nerqia..." }: { label?: string }) {
  return (
    <div className="app-boot-shell min-h-screen flex items-center justify-center" role="status" aria-live="polite">
      <div className="text-center px-6">
        <BrandLogo decorative eager className="justify-center mb-5" markClassName="h-10 w-10" nameClassName="text-lg" />
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-muted-foreground text-sm font-medium tracking-tight">{label}</p>
      </div>
    </div>
  );
}
