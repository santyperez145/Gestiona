/**
 * Sesión para los tests que necesitan estar adentro.
 *
 * Corre una vez antes del resto y deja la sesión guardada en un archivo que
 * Playwright reusa. Así los specs autenticados no pasan por el formulario de
 * login: se ahorra tiempo y, sobre todo, la contraseña no viaja por la UI ni
 * queda en un trace.
 *
 * Las credenciales salen de variables de entorno y **nunca** se imprimen. El
 * archivo de sesión está en `.gitignore`: es un token válido, tratarlo como
 * cualquier otro secreto.
 *
 * Localmente, si no están definidas, los specs autenticados se saltean y el
 * resto de la suite sigue corriendo. En CI `E2E_REQUIRE_AUTH=true` transforma
 * una credencial ausente en error: el gate nunca queda verde por no haber
 * ejecutado la mitad autenticada.
 *
 *   E2E_USER=alguien@ejemplo.com
 *   E2E_PASSWORD=...
 */
import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

/** Relativa a la raíz: `__dirname` no existe en módulos ES. */
export const ARCHIVO_SESION = "e2e/.auth/usuario.json";

setup("iniciar sesión", async ({ page }) => {
  const email = process.env.E2E_USER;
  const password = process.env.E2E_PASSWORD;
  const requireAuth = process.env.E2E_REQUIRE_AUTH === "true";

  if (!email || !password) {
    if (requireAuth) {
      throw new Error("Falta E2E_USER / E2E_PASSWORD y E2E_REQUIRE_AUTH=true");
    }
    setup.skip(true,
      "Falta E2E_USER / E2E_PASSWORD: se saltean los tests del panel");
  }

  const url = process.env.VITE_SUPABASE_URL
    ?? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
  const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

  expect(url, "falta la URL de Supabase en el entorno").toBeTruthy();
  expect(anon, "falta la clave anónima en el entorno").toBeTruthy();

  // Se autentica contra la API, no contra el formulario: el objetivo es tener
  // sesión, no probar el login. Ese flujo merece su propio spec.
  const supabase = createClient(url!, anon!);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email!, password: password!,
  });

  // El mensaje no repite la credencial: si falla, alcanza con saber que falló.
  expect(error, `no se pudo iniciar sesión con E2E_USER: ${error?.message ?? ""}`).toBeNull();
  expect(data.session, "Supabase no devolvió sesión").toBeTruthy();

  // El cliente guarda la sesión bajo una clave derivada del ref del proyecto.
  const ref = new URL(url!).hostname.split(".")[0];
  const clave = `sb-${ref}-auth-token`;

  await page.goto("/");
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k, v),
    [clave, JSON.stringify(data.session)] as const,
  );

  fs.mkdirSync("e2e/.auth", { recursive: true });
  await page.context().storageState({ path: ARCHIVO_SESION });
});
