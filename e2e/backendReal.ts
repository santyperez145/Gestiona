import { test } from "@playwright/test";

/**
 * Para los specs que leen datos reales (tienda pública, sesión del panel).
 * Si el chequeo previo (`backend.global-setup.ts`) encontró la base caída,
 * cada test falla en el acto con la causa, en vez de esperar su timeout.
 */
export function exigirBackendReal(): void {
  test.beforeEach(() => {
    const caido = process.env.E2E_BACKEND_CAIDO;
    if (caido) {
      throw new Error(`La base de Supabase no responde: ${caido}. Este test lee datos reales; revisá el estado del proyecto en Supabase.`);
    }
  });
}
