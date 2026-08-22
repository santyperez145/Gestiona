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
