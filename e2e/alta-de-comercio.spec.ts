import { expect, test } from "@playwright/test";

/**
 * El alta de un comercio nuevo de punta a punta (2026-10-31): registrarse
 * desde la pantalla, recibir el mail de confirmación, confirmar, entrar con el
 * formulario de login y llegar al panel con su negocio creado. Es la puerta de
 * entrada de la inauguración: si falla, no entra nadie. Hasta hoy los E2E
 * entraban con un usuario sembrado y este camino no lo recorría ninguno.
 *
 * ESCRIBE DATOS. Corre sólo contra el Supabase local de `e2e-local.yml`, que
 * levanta Mailpit para recibir el mail (E2E_LOCAL=true). La contraseña es de
 * prueba, se genera en cada corrida y no se imprime.
 */
const url = (() => { try { return new URL(process.env.VITE_SUPABASE_URL ?? ""); } catch { return null; } })();
const LOCAL = process.env.E2E_LOCAL === "true" && !!url && ["127.0.0.1", "localhost"].includes(url.hostname);
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

test.skip(!LOCAL, "El alta crea un usuario y un negocio: corre sólo contra la base local del E2E (E2E_LOCAL=true).");

test("un comercio nuevo se registra, confirma su correo y entra a su panel", async ({ page, request }) => {
  test.setTimeout(150_000);
  const sufijo = Date.now().toString(36);
  const email = `alta-${sufijo}@nerqia.test`;
  const nombre = `ZZ Alta ${sufijo}`;
  // Minúscula, mayúscula, número y símbolo, como pide passwordSecurity.ts.
  const clave = `Zz!2026-${sufijo}-Alta-${Math.random().toString(36).slice(2, 10)}`;

  // 1. Registro desde la pantalla.
  await page.goto("/login?mode=register");
  await page.getByLabel("Nombre").fill(nombre);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(clave);
  await page.getByRole("button", { name: /Crear mi workspace/ }).click();
  await expect(page.getByText("Te enviamos un correo para confirmar tu cuenta.")).toBeVisible({ timeout: 30_000 });

  // 2. El mail de confirmación llega con nuestra plantilla y su enlace.
  let enlace = "";
  let asunto = "";
  await expect.poll(async () => {
    const busqueda = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    if (!busqueda.ok()) return "";
    const { messages } = await busqueda.json() as { messages?: Array<{ ID: string; Subject?: string }> };
    if (!messages?.length) return "";
    asunto = messages[0].Subject ?? "";
    const mensaje = await (await request.get(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json() as { HTML?: string; Text?: string };
    const cuerpo = `${mensaje.HTML ?? ""}\n${mensaje.Text ?? ""}`;
    enlace = (cuerpo.match(/https?:\/\/[^"'\s<>]+\/auth\/v1\/verify\?[^"'\s<>]+/)?.[0] ?? "").replace(/&amp;/g, "&");
    return enlace;
  }, { timeout: 45_000, message: "no llegó el mail de confirmación" }).not.toBe("");
  expect(asunto).toContain("Confirmá tu correo");

  // 3. Confirmar: el enlace valida la cuenta y redirige al sitio.
  const confirmacion = await request.get(enlace, { maxRedirects: 0 });
  expect([200, 301, 302, 303, 307]).toContain(confirmacion.status());

  // 4. Entrar con el formulario de login y llegar al panel del negocio nuevo.
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(clave);
  await page.getByRole("button", { name: /Entrar a Nerqia/ }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(
    page.getByText(`${nombre} Workspace`).or(page.getByRole("button", { name: /ruta de activación/ })).first(),
  ).toBeVisible({ timeout: 45_000 });
});
