import BrandLogo from '@/components/shared/BrandLogo';
import WorkspaceState from '@/components/shared/WorkspaceState';

export default function AccessLoadError({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <main className="app-boot-shell flex min-h-screen items-center justify-center p-4">
      <section aria-label="Recuperar acceso" className="w-full max-w-lg text-center">
        <BrandLogo decorative eager className="mb-6 justify-center" />
        <WorkspaceState kind="error-recoverable" layout="embedded"
          title="No pudimos verificar tu acceso"
          description="Tu sesión sigue abierta. Volvé a intentar; si el problema continúa, contactá a soporte."
          actionLabel="Volver a intentar" onAction={() => { void onRetry(); }} />
      </section>
    </main>
  );
}
