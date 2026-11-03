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
  // El recorrido en capturas (2026-11-02): el CI las publica siempre como
  // artefacto, para revisar la experiencia de un comercio nuevo paso a paso.
  let paso = 0;
  const foto = async (p: import("@playwright/test").Page, nombre: string) => {
    paso += 1;
    await p.screenshot({ path: `recorrido/${String(paso).padStart(2, "0")}-${nombre}.png`, fullPage: true }).catch(() => undefined);
  };

  // 1. Registro desde la pantalla.
  await page.goto("/login?mode=register");
  await foto(page, "registro");
  await page.getByLabel("Nombre").fill(nombre);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(clave);
  await page.getByRole("button", { name: /Crear mi cuenta gratis/ }).click();
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

  // 4. Entrar con el formulario de login: el negocio nuevo cae directo en el
  // asistente de inicio, a pantalla completa (sin el menú del panel).
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(clave);
  await page.getByRole("button", { name: /Entrar a Nerqia/ }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 45_000 });

  // 5. El asistente de inicio (2026-11-02): nombre, rubro, color y canal. Es lo
  // primero que hace cada comercio y ningún E2E lo recorría con una cuenta nueva.
  await expect(page.getByRole("heading", { name: "¿Cómo se llama tu negocio?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Tienda online" })).toHaveCount(0);
  await foto(page, "asistente-nombre");
  await sinBarrerasGraves(page, "asistente de inicio");
  await page.getByLabel("Nombre del negocio").fill(nombre);
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await expect(page.getByRole("heading", { name: "¿Qué vendés?" })).toBeVisible();
  await foto(page, "asistente-rubro");
  await page.getByRole("group", { name: "Rubros" }).getByRole("button").first().click();
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await expect(page.getByRole("heading", { name: "Color de marca" })).toBeVisible();
  await sinBarrerasGraves(page, "color de marca");
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await foto(page, "asistente-canal");
  await page.getByRole("button", { name: /Publicar mi tienda online/ }).click();

  // 6. El primer producto: el asistente abre la carga y se guarda con stock.
  await expect(page).toHaveURL(/\/productos\?onboarding=1&goal=online/, { timeout: 30_000 });
  const editor = page.getByRole("dialog", { name: "Nuevo producto" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await sinBarrerasGraves(page, "primer producto");
  await foto(page, "primer-producto");
  const producto = `ZZ PRIMERO ${sufijo.toUpperCase()}`;
  await editor.getByLabel("Nombre *").fill(producto);
  await editor.getByLabel("Precio de venta *").fill("12500");
  await editor.getByLabel(/^Unidades/).fill("7");
  await editor.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });

  // 7. La tienda (2026-11-02): lo que promete la landing, «creá tu tienda y
  // vendé hoy». El asistente lleva a crearla; se sigue el camino guiado.
  await expect(page).toHaveURL(/\/tienda-online/, { timeout: 30_000 });
  const slug = `zz-alta-${sufijo}`;
  await foto(page, "tienda-crear");
  await page.getByLabel("Nombre de la tienda").fill(`ZZ Tienda ${sufijo}`);
  await page.getByLabel("Link de la tienda").fill(slug);
  await sinBarrerasGraves(page, "crear la tienda");
  await page.getByRole("button", { name: "Crear tienda" }).click();

  // Cobro por transferencia: sin alias no hay primera venta.
  await foto(page, "tienda-cobro");
  await page.getByLabel("Titular").fill("ZZ Alta Prueba");
  await page.getByLabel("Alias").fill(`zz.alta.${sufijo}`);
  await page.getByRole("button", { name: "Guardar datos para transferir" }).click();

  // Retiro en tienda viene activo: sin dirección el pedido dice «te contactamos».
  await page.getByLabel("Dirección de retiro").fill("Av. Corrientes 1234, CABA");
  await page.getByLabel("Horario de retiro").fill("Lun a vie 10 a 18");
  await foto(page, "tienda-retiro");
  await page.getByRole("button", { name: "Guardar dirección de retiro" }).click();

  // Términos y privacidad: se generan con los datos del comercio y se publican.
  await page.getByRole("button", { name: "Ir a Páginas" }).click();
  await foto(page, "tienda-legales");
  // Se tipea letra por letra, como una persona: el formulario desaparecía al
  // tipear la primera letra del último campo (2026-11-03) y fill() no lo veía.
  await page.getByLabel("Razón social o tu nombre").pressSequentially(`ZZ Alta ${sufijo} SRL`);
  await page.getByLabel("CUIT").pressSequentially("30-71234567-1");
  await page.getByLabel("Domicilio comercial").pressSequentially("Av. Corrientes 1234, CABA");
  await page.getByLabel("Email de contacto").pressSequentially(email);
  await expect(page.getByLabel("Email de contacto")).toHaveValue(email);
  await page.getByRole("button", { name: "Generar los textos legales" }).click();
  // Se leen y se publican los dos de una vez (antes, unos ocho clics).
  await expect(page.getByRole("button", { name: /^Leer / }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("checkbox", { name: /Leí los textos/ }).check();
  await page.getByRole("button", { name: "Publicar términos y privacidad" }).click();
  await expect(page.getByText("Términos y privacidad publicados").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Leer / })).toHaveCount(0, { timeout: 15_000 });

  // Publicar la tienda desde el recorrido guiado.
  await page.goto("/tienda-online?onboarding=1&goal=online");
  await foto(page, "tienda-publicar");
  await page.getByRole("button", { name: "Publicar la tienda" }).click();
  await expect(page.getByRole("button", { name: "Publicar la tienda" })).toHaveCount(0, { timeout: 30_000 });
  // Publicada y sin ventas: el kit para conseguir la primera (link, WhatsApp, QR, cartel).
  await expect(page.getByRole("heading", { name: /compartila|Compartí tu tienda/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /Mandar por WhatsApp/ })).toHaveAttribute("href", new RegExp(slug));
  await foto(page, "tienda-publicada");
  await page.goto("/");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await foto(page, "panel-inicio");

  // 8. Un comprador sin sesión entra a la tienda y ve el producto.
  const comprador = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
  const vidriera = await comprador.newPage();
  await vidriera.goto(`/tienda/${slug}`);
  // La tienda puede mostrar el nombre con otras mayúsculas.
  await expect(vidriera.getByText(new RegExp(producto, "i")).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  await foto(vidriera, "comprador-tienda");
  await vidriera.setViewportSize({ width: 390, height: 844 });
  await foto(vidriera, "comprador-tienda-celular");
  await comprador.close();
});

/** Sin infracciones críticas ni graves de WCAG A/AA en la pantalla actual. */
async function sinBarrerasGraves(page: import("@playwright/test").Page, pantalla: string) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const graves = violations.filter(v => v.impact === "critical" || v.impact === "serious");
  expect(graves.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}`)), `barreras en ${pantalla}`).toEqual([]);
}
