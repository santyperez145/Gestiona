/**
 * La tienda, de punta a punta.
 *
 * Los tests unitarios cubren cálculos; los bugs que costaron plata fueron de
 * integración y ninguno los habría agarrado:
 *
 *   - La ficha de un producto agotado devolvía "Producto no encontrado",
 *     porque la vista del catálogo filtraba `stock > 0`. Se perdían la visita
 *     y la URL indexada.
 *   - El checkout rechazaba a 22 de 23 provincias por falta de tarifas,
 *     mientras el panel decía que la tienda estaba lista para vender.
 *   - El seguimiento en "Mis pedidos" tenía la condición invertida.
 *
 * Estos specs son **de sólo lectura**: leen la base de producción, que es la
 * única que hay. Ninguno crea una orden. El día que haga falta cubrir el
 * checkout completo, va con datos `ZZ` y limpieza.
 */
import { test, expect, type Page } from "@playwright/test";

const SLUG = process.env.E2E_STORE_SLUG ?? "exentryimports";
const tienda = (ruta = "") => `/tienda/${SLUG}${ruta}`;

/** Espera a que el catálogo termine de cargar y devuelve los links a fichas. */
async function fichasVisibles(page: Page) {
  const fichas = page.locator(`a[href*="/tienda/${SLUG}/producto/"]`);
  await expect(fichas.first()).toBeVisible();
  return fichas;
}

test.describe("vitrina", () => {
  test("la home carga con productos y sin errores de consola", async ({ page }) => {
    const errores: string[] = [];
    page.on("console", m => { if (m.type() === "error") errores.push(m.text()); });
    page.on("pageerror", e => errores.push(e.message));

    await page.goto(tienda());
    await fichasVisibles(page);

    // Una tienda que carga con errores en consola hoy es una que mañana
    // aparece en blanco.
    expect(errores, `errores en consola:\n${errores.join("\n")}`).toEqual([]);
  });

  test("no desborda a lo ancho en un teléfono", async ({ page }) => {
    await page.goto(tienda());
    await fichasVisibles(page);

    const { scroll, cliente } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      cliente: document.documentElement.clientWidth,
    }));
    // El scroll horizontal en una tienda se traduce en carritos abandonados.
    expect(scroll, "la página scrollea de costado").toBeLessThanOrEqual(cliente);
  });
});

test.describe("catálogo", () => {
  test("una card con variantes deriva la decisión completa a una sola ficha", async ({ page }) => {
    await page.goto(tienda("/productos"));
    await fichasVisibles(page);

    const card = page.locator(".storefront-product-card[data-variant-count]").first();
    if (!(await card.count())) {
      test.skip(true, "el catálogo actual no tiene productos con variantes");
    }

    const total = Number(await card.getAttribute("data-variant-count"));
    expect(total).toBeGreaterThan(0);
    await expect(card.getByRole("radio")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Agregar" })).toHaveCount(0);
    const elegir = card.getByRole("link", { name: /^Elegir / });
    await expect(elegir).toBeVisible();
    await expect(elegir).toHaveAttribute("href", /\/producto\//);

    const geometry = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  });

  test("la paginación usa enlaces reales, veinte cards y no desborda", async ({ page }) => {
    const errores: string[] = [];
    page.on("console", message => {
      if (message.type() === "error") errores.push(message.text());
    });
    page.on("pageerror", error => errores.push(error.message));

    await page.goto(tienda("/productos?page=2"));
    await fichasVisibles(page);
    const nav = page.getByRole("navigation", { name: "Páginas del catálogo" });
    await expect(nav).toContainText("Página 2 de");
    await expect(page.locator(".storefront-products__grid > *")).toHaveCount(20);

    const anterior = nav.getByRole("link", { name: "Anterior" });
    await expect(anterior).toHaveAttribute("rel", "prev");
    await expect(anterior).toHaveAttribute("href", /^(?!javascript:).+/);

    const siguiente = nav.getByRole("link", { name: "Siguiente" });
    if (await siguiente.count()) {
      await expect(siguiente).toHaveAttribute("rel", "next");
      await expect(siguiente).toHaveAttribute("href", /page=3/);
      await siguiente.click();
      await expect(page).toHaveURL(/(?:\?|&)page=3(?:&|$)/);
      await expect(nav).toContainText("Página 3 de");
    }

    const geometry = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      targets: [...document.querySelectorAll<HTMLElement>('nav[aria-label="Páginas del catálogo"] a')]
        .map(element => element.getBoundingClientRect().height),
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.targets.every(height => height >= 44)).toBe(true);
    expect(errores, `errores en consola:\n${errores.join("\n")}`).toEqual([]);
  });

  test("el filtro por precio vive en la URL y se respeta", async ({ page }) => {
    await page.goto(tienda("/productos?min=50000&max=90000"));
    await fichasVisibles(page);

    const precios = await page.evaluate(() =>
      [...document.querySelectorAll(".text-base.font-bold")]
        .map(e => Number(e.textContent?.replace(/[^0-9]/g, "")))
        .filter(n => Number.isFinite(n) && n > 0));

    expect(precios.length, "el rango no devolvió ningún producto").toBeGreaterThan(0);
    for (const p of precios) {
      expect(p, `${p} pesos está fuera del rango pedido`).toBeGreaterThanOrEqual(50_000);
      expect(p, `${p} pesos está fuera del rango pedido`).toBeLessThanOrEqual(90_000);
    }
  });

  test("un rango invertido lo dice en vez de mostrar la grilla vacía", async ({ page }) => {
    await page.goto(tienda("/productos?min=90000&max=1000"));
    // Se ancla en el bloque de "no hay resultados" y no en el primero que
    // matchee: el de la barra de filtros existe en el DOM pero en el teléfono
    // está colapsado, y un aviso que no se ve no sirve de nada. Lo que importa
    // es que aparezca donde el comprador está mirando.
    const vacio = page.getByText("No encontramos productos con esos filtros")
      .locator("xpath=..");
    await expect(vacio.getByText("El máximo es menor que el mínimo")).toBeVisible();
  });
});

test.describe("ficha de producto", () => {
  test("abre desde el catálogo y ofrece opiniones", async ({ page }) => {
    await page.goto(tienda("/productos"));
    const fichas = await fichasVisibles(page);
    await fichas.first().click();

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // La sección existe aunque no haya reseñas todavía: la prueba social es
    // parte de la ficha, no un extra que aparece cuando hay datos.
    await expect(page.getByRole("heading", { name: "Opiniones" })).toBeVisible();
  });

  test("un producto agotado sigue teniendo ficha y ofrece avisar", async ({ page }) => {
    // Este es el bug: el catálogo filtraba `stock > 0` y la ficha del agotado
    // devolvía "Producto no encontrado". Si no hay ninguno sin stock, no hay
    // nada que verificar y el test se saltea en vez de mentir.
    await page.goto(tienda("/productos"));
    await fichasVisibles(page);

    const agotado = page.locator("text=Sin stock").first();
    if (!(await agotado.count())) {
      test.skip(true, "no hay productos agotados en el catálogo ahora mismo");
    }

    await agotado.locator("xpath=ancestor::a[1]").click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Producto no encontrado")).toHaveCount(0);
    await expect(page.getByText("Sin stock por ahora")).toBeVisible();
    await expect(page.getByPlaceholder("tu@email.com")).toBeVisible();
  });

  test("una variante agotada conserva su aviso y no promete envío", async ({ page }) => {
    const errores: string[] = [];
    page.on("console", mensaje => {
      if (mensaje.type() === "error") errores.push(mensaje.text());
    });
    page.on("pageerror", error => errores.push(error.message));

    await page.goto(tienda("/productos"));
    await fichasVisibles(page);

    // La card compacta no ofrece quick-add de variantes agotadas: las marca con
    // metadata semántica y deriva su decisión completa a la ficha. El test no
    // agrega al carrito, no envía el formulario y no escribe en producción.
    const card = page.locator('.storefront-product-card[data-has-sold-out-variants="true"]').first();
    if (!(await card.count())) {
      test.skip(true, "no hay una variante agotada visible en el catálogo actual");
    }
    const href = await card.locator('a[href*="/producto/"]').first().getAttribute("href");
    expect(href, "la card con variante agotada no enlaza a su ficha").toBeTruthy();
    await page.goto(href!);

    await expect(page.getByText(/Elegí (un|una) .+ para ver disponibilidad/)).toBeVisible();
    await expect(page.getByText("Envío a tu provincia")).toHaveCount(0);

    const agotada = page.getByRole("radio", { name: /agotado/i }).first();
    await expect(agotada).toBeVisible();
    await agotada.click();
    await expect(agotada).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Esta variante está agotada.")).toBeVisible();
    await expect(page.getByText("Sin stock por ahora")).toBeVisible();
    await expect(page.getByPlaceholder("tu@email.com")).toBeVisible();
    await expect(page.getByText("Envío a tu provincia")).toHaveCount(0);

    const disponible = page.getByRole("radio", { name: /disponibles|última unidad/i }).first();
    await expect(disponible).toBeVisible();
    await disponible.click();
    await expect(disponible).toHaveAttribute("aria-checked", "true");
    // En desktop bajo puede quedar debajo del pliegue y el sticky existe sólo
    // en mobile. Se lleva a viewport antes de exigir su nombre accesible.
    await page.locator("button").filter({ hasText: "Agregar al carrito" }).first().scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Agregar al carrito" }).first()).toBeVisible();
    await expect(page.getByText("Envío a tu provincia")).toBeVisible();

    const geometry = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(geometry.scrollWidth, "la ficha con variantes desborda a lo ancho")
      .toBeLessThanOrEqual(geometry.clientWidth);
    expect(errores, `errores en consola:\n${errores.join("\n")}`).toEqual([]);
  });

  test("preguntas: se listan las respondidas y sin cuenta se invita a entrar", async ({ page }) => {
    await page.goto(tienda("/productos"));
    const fichas = await fichasVisibles(page);
    await fichas.first().click();

    await expect(page.getByRole("heading", { name: "Preguntas y respuestas" })).toBeVisible();

    // Sin sesión no hay caja de texto: preguntar pide cuenta, y el link a
    // /cuenta es lo único que se ofrece.
    await expect(page.getByPlaceholder("¿Qué querés saber de este producto?")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Iniciá sesión" }).first()).toBeVisible();
  });

  test("ninguna sección de la ficha aparece vacía", async ({ page }) => {
    // El "Perfil olfativo" se mostraba con el título y nada debajo cuando la
    // fila de detalle existía pero estaba vacía, y `0 || 0` dejaba un cero
    // suelto en el medio de la página.
    await page.goto(tienda("/productos"));
    const fichas = await fichasVisibles(page);
    await fichas.first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const perfil = page.getByRole("heading", { name: "Perfil olfativo" });
    if (await perfil.count()) {
      // Si está el título, tiene que haber contenido real abajo.
      const seccion = perfil.locator("xpath=..");
      expect((await seccion.innerText()).replace("Perfil olfativo", "").trim().length).toBeGreaterThan(0);
    }

    const ceroSuelto = await page.evaluate(() =>
      [...document.querySelectorAll("div")].some(
        d => d.lastChild?.nodeType === 3 && d.lastChild.nodeValue?.trim() === "0",
      ),
    );
    expect(ceroSuelto, "un `x && y` con x numérico dejó un 0 impreso en la página").toBe(false);
  });
});

test.describe("carrito", () => {
  test("el producto viaja de la ficha al checkout", async ({ page }) => {
    await page.goto(tienda("/productos"));
    const fichas = await fichasVisibles(page);
    await fichas.first().click();

    const titulo = await page.getByRole("heading", { level: 1 }).innerText();
    await page.getByRole("button", { name: /Agregar al carrito/i }).click();

    // El contador del header es la señal inmediata de que entró al carrito.
    await expect(page.getByLabel(/Carrito, \d+ artículo/)).toBeVisible();

    await page.goto(tienda("/checkout"));
    // Anclar en el encabezado y no en el body entero: leer `innerText` antes
    // de que monte devolvía cadena vacía y el test fallaba por lento, no por
    // roto.
    await expect(page.getByRole("heading", { name: "Finalizar compra" })).toBeVisible();

    // El resumen tiene que nombrar lo que se agregó. Si el carrito se
    // vaciara al navegar —localStorage por slug— esto lo agarra.
    await expect(page.getByText("Tu pedido")).toBeVisible();
    await expect(page.locator("body")).toContainText(titulo.split(" ")[0]);
  });
});

test.describe("páginas de contenido", () => {
  test("las publicadas se listan en el pie y abren", async ({ page }) => {
    await page.goto(tienda());
    await fichasVisibles(page);

    const info = page.locator("footer").getByRole("link");
    const cuantas = await info.count();
    expect(cuantas, "el pie quedó sin ningún link").toBeGreaterThan(0);

    const dePagina = page.locator(`footer a[href*="/pagina/"]`);
    if (!(await dePagina.count())) {
      test.skip(true, "no hay páginas de contenido publicadas");
    }

    await dePagina.first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // El markdown se renderiza a elementos, no a HTML crudo: si apareciera un
    // `<h2>` escapado como texto, el parser se rompió.
    await expect(page.locator("article")).toBeVisible();
  });
});
