import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  FORMATO_INFORME,
  personaDe,
  reglasDelAnalisis,
  SIN_RUBRO,
  type PerfilDelComercio,
} from "../../supabase/functions/_shared/promptDelComercio";

/**
 * El rubro del comercio no se adivina, y menos dentro de un prompt.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * `ai-analysis` tenía un `GUARDRAIL_TEXT` que usaban cinco de sus seis tipos
 * y que encerraba al asistente en perfumería árabe y vapers, con la
 * instrucción literal de responder EXACTAMENTE «Solo puedo ayudarte con
 * análisis de tu negocio de perfumes y vapers» ante cualquier otra cosa.
 *
 * O sea que un comercio de otro rubro abría IA Insights o el generador de
 * marketing y recibía esa negativa, o un análisis que hablaba de productos que
 * no vende. Lo mismo en `generate-social-copy`, `predict-sales` y
 * `extract-invoice`. Es la misma familia que el `DEFAULT 'perfumes'` de
 * `settings.industry_code` y el `DEFAULT 'perfume_arabe'` de
 * `products.category` — ver `categoriaSinRubroPorDefault`.
 *
 * ⚠️ Y ya se había intentado por el lado equivocado: `MarketingPage` mandaba
 * `data.industry` a `marketing_copy`, que sólo lee `products`, `postType` y
 * `theme`. El campo se descartaba en silencio, exactamente como el
 * `instructions` de `AIProactiveWidget` — ver `elPromptLoArmaElServidor`.
 * Por eso la mitad de abajo: el rubro lo resuelve el servidor o no se resuelve.
 */
describe("el rubro no lo adivina el prompt", () => {
  const ROOT = resolve(__dirname, "../..");
  const FUNCIONES = resolve(ROOT, "supabase/functions");

  /**
   * Palabras que sólo tienen sentido si el comercio vende eso.
   *
   * ⚠️ `pod` va con límites Unicode y no con `\b`. Con `\b` matcheaba
   * **«podés»**: `\w` es `[A-Za-z0-9_]`, así que entre la `d` y la `é` hay
   * límite de palabra. Lo encontró este mismo test al correrlo por primera
   * vez, marcando **nueve** funciones que sólo dicen «podés» en un mensaje al
   * usuario. Es el pariente de `LIKE '%_iva%'` matcheando «inactiva»: una
   * búsqueda difusa que encuentra de más no sirve, y hay que probarla en los
   * dos sentidos.
   */
  const PALABRAS_DE_RUBRO =
    /perfum|vaper|lattafa|armaf|olfativ|decant|pasero|(?<!\p{L})pods?(?!\p{L})/iu;

  /**
   * El archivo sin sus comentarios.
   *
   * Los archivos de este repo explican en prosa qué sacaron y por qué, así que
   * buscar el término retirado a secas lo encuentra en su propia lápida. Lo
   * que importa es que no quede en el código — mismo criterio que
   * `categoriaSinRubroPorDefault`.
   */
  const soloCodigo = (fuente: string) =>
    fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const lineasConRubro = (fuente: string) =>
    soloCodigo(fuente).split("\n").map(l => l.trim()).filter(l => PALABRAS_DE_RUBRO.test(l));

  const leerFuncion = (nombre: string) =>
    readFileSync(resolve(FUNCIONES, nombre, "index.ts"), "utf8");

  /**
   * Las que arman un prompt y resuelven el rubro en el servidor.
   *
   * 📌 Que estén acá no significa que el archivo no pueda nombrar un rubro por
   * otro motivo —`generate-social-copy` conserva los rótulos de slug
   * heredados—. De eso se ocupa TODAVIA_NOMBRAN_UN_RUBRO, que además mira
   * TODAS las funciones y no sólo estas cuatro.
   */
  const YA_RESUELVEN_EL_RUBRO = [
    "ai-analysis",
    "generate-social-copy",
    "predict-sales",
    "extract-invoice",
  ];

  /**
   * Lo que todavía nombra un rubro, con el motivo escrito.
   *
   * 📌 No es una lista de perdón: es lo que hace que la deuda no crezca sin que
   * nadie la vea. Una función que no esté acá tiene que dar cero.
   */
  const TODAVIA_NOMBRAN_UN_RUBRO: Record<string, { motivo: string; lineas: RegExp }> = {
    "meli-sync": {
      motivo:
        "No es el rubro del comercio: es una regla real de MercadoLibre Argentina — ANMAT tiene prohibidos los vapers y publicarlos rebota. Sacarlo rompería una validación correcta.",
      lineas: /CATEGORIAS_PROHIBIDAS|ANMAT/,
    },
    "ai-offer-recommender": {
      motivo:
        "`pack_decants` es un tipo de oferta atado al rubro, no una línea de prompt. Sale con el catálogo polimórfico (P0.1), junto con los demás tipos por rubro.",
      lineas: /pack_decants/,
    },
    "generate-social-copy": {
      motivo:
        "Rótulo de un slug ya cargado (`perfume_arabe`, `vaper`), no el rubro del prompt — mismo criterio que `NOMBRES_HEREDADOS` en `storeCategories.ts`. La persona y los hashtags ya salen de `settings.industry_code`.",
      lineas: /catLabel|perfume_arabe|perfume_diseñador|"vaper"/,
    },
    "generate-description": {
      motivo:
        "La ficha de perfume es una feature de rubro entera —`emit_perfume_profile`, familia olfativa, notas, `product_perfume_details`—, no una línea de persona. Reemplazarla es el catálogo polimórfico (P0.1: `product_types` y sus atributos), no cambiar un texto.",
      lineas: /./,
    },
  };

  // ── La mitad de comportamiento: qué dice el prompt ───────────────────────

  it("sin rubro elegido, el prompt no nombra ninguno y prohíbe suponerlo", () => {
    const reglas = reglasDelAnalisis(SIN_RUBRO);

    expect(reglas, "el prompt sin rubro nombra un rubro").not.toMatch(PALABRAS_DE_RUBRO);
    // NULL es «todavía no eligió», un estado real — no un sinónimo de nada.
    expect(reglas).toContain("todavía no lo eligió");
    expect(reglas).toContain("No lo supongas");
  });

  it("y tampoco lo nombra la persona ni el formato", () => {
    expect(personaDe("un analista de negocios senior", SIN_RUBRO)).not.toMatch(PALABRAS_DE_RUBRO);
    expect(FORMATO_INFORME).not.toMatch(PALABRAS_DE_RUBRO);
  });

  it("con rubro elegido, el prompt habla de ESE rubro", () => {
    const gastronomia: PerfilDelComercio = {
      rubro: "gastronomia",
      nombreRubro: "Gastronomía",
      tono: "cálido y directo",
    };

    const reglas = reglasDelAnalisis(gastronomia);
    expect(reglas).toContain("Gastronomía");
    // Y no arrastra el rubro del negocio original.
    expect(reglas, "el prompt de una gastronomía habla de otro rubro").not.toMatch(PALABRAS_DE_RUBRO);

    const persona = personaDe("analista de inventario senior", gastronomia);
    expect(persona).toContain("un comercio de Gastronomía en Argentina");
    expect(persona).toContain("cálido y directo");
  });

  it("⚠️ el comercio que SÍ eligió perfumería no pierde su vocabulario", () => {
    /**
     * La especificidad no se borra: se muda de código a datos. Exentry Imports
     * tiene `settings.ai_tone = 'experto en perfumería árabe y de diseñador,
     * rioplatense'` —copiado de `industry_presets` al elegir el rubro—, así que
     * su persona lo sigue diciendo. Medido contra la base el 2026-08-27.
     *
     * 📌 Sin esto, «sacar el rubro del prompt» sería una regresión para la
     * única organización que opera de verdad.
     */
    const exentry: PerfilDelComercio = {
      rubro: "perfumes",
      nombreRubro: "Perfumes",
      tono: "experto en perfumería árabe y de diseñador, rioplatense",
    };

    const persona = personaDe("un analista de negocios senior", exentry);
    expect(persona).toContain("un comercio de Perfumes en Argentina");
    expect(persona).toContain("experto en perfumería árabe y de diseñador");
  });

  it("nunca sale la negativa que rechazaba a los demás rubros", () => {
    const negativa = "Solo puedo ayudarte con análisis de tu negocio de perfumes y vapers";
    for (const perfil of [SIN_RUBRO, { rubro: "servicios", nombreRubro: "Servicios", tono: null }]) {
      expect(reglasDelAnalisis(perfil)).not.toContain(negativa);
    }
    expect(leerFuncion("ai-analysis"), "volvió la negativa literal").not.toContain(negativa);
  });

  // ── La mitad de contrato: quién resuelve el rubro ────────────────────────

  it("y lo resuelven en el servidor, con el JWT del usuario", () => {
    for (const fn of YA_RESUELVEN_EL_RUBRO) {
      const src = leerFuncion(fn);
      expect(src, `${fn} no resuelve el rubro en el servidor`).toContain("leerPerfilDelComercio(req,");
      // Sobre el código, no sobre la prosa: `daily_pulse` cuenta en su
      // comentario que nació esquivando el `GUARDRAIL_TEXT`, y esa lápida
      // tiene que poder quedarse.
      expect(soloCodigo(src), `${fn} sigue teniendo el guardrail de rubro`)
        .not.toContain("GUARDRAIL_TEXT");
    }

    const lector = readFileSync(resolve(FUNCIONES, "_shared/perfilDelComercio.ts"), "utf8");
    expect(lector, "el rubro sale de settings.industry_code").toContain("industry_code");
    // ⚠️ Con `service_role` `auth.uid()` es NULL, la RLS de `settings` no acota
    // nada y alguien podría mandar el `org_id` de otro comercio para pedirle
    // prestado el rubro. Mismo motivo que en `leerEntitlements`.
    expect(soloCodigo(lector), "el rubro se leería con service_role").not.toMatch(/SERVICE_ROLE/i);
    expect(lector).toContain("Authorization: authHeader");
  });

  it("ninguna pantalla le manda el rubro a una función de IA", () => {
    /**
     * La mitad espejo de `elPromptLoArmaElServidor`: igual que el prompt, el
     * rubro es una decisión del servidor. Mandarlo desde el navegador es lo
     * cómodo —no hay que deployar la función— y ya se hizo una vez sin que
     * nadie se enterara, porque el campo se descartaba en silencio.
     */
    const CAMPOS_DE_RUBRO = ["industry", "industryCode", "industry_code", "rubro"];
    const FUNCIONES_IA = [
      "generate-description", "generate-social-copy", "ai-analysis",
      "predict-sales", "extract-invoice", "ai-deal-coach",
    ];

    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, d.name);
        if (d.isDirectory()) recorrer(p);
        else if (d.name.endsWith(".ts") || d.name.endsWith(".tsx")) archivos.push(p);
      }
    };
    for (const raiz of ["src/components", "src/pages"]) recorrer(resolve(ROOT, raiz));

    /** El texto de la llamada, desde el nombre de la función hasta su `)`. */
    const textoDeLaLlamada = (src: string, fn: string): string | null => {
      const m = new RegExp(`(?:llamarIA|functions\\.invoke)\\(\\s*["']${fn}["']`).exec(src);
      if (!m) return null;
      let nivel = 0;
      for (let i = src.indexOf("(", m.index); i < src.length; i++) {
        if (src[i] === "(") nivel++;
        else if (src[i] === ")" && --nivel === 0) return src.slice(m.index, i + 1);
      }
      return null;
    };

    const culpables: string[] = [];
    for (const p of archivos) {
      const src = readFileSync(p, "utf8");
      for (const fn of FUNCIONES_IA) {
        const llamada = textoDeLaLlamada(src, fn);
        if (!llamada) continue;
        for (const campo of CAMPOS_DE_RUBRO) {
          if (new RegExp(`\\b${campo}\\s*:`).test(llamada)) {
            culpables.push(`${p.replace(ROOT, "").replace(/\\/g, "/")} → ${fn} manda \`${campo}\``);
          }
        }
      }
    }

    expect(
      culpables,
      `el rubro lo lee la Edge Function de \`settings.industry_code\`, no lo manda la pantalla: ${culpables.join(", ")}`,
    ).toEqual([]);
  });

  it("lo que todavía nombra un rubro está enumerado, con el motivo escrito", () => {
    const inesperados: string[] = [];

    for (const dir of readdirSync(FUNCIONES, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === "_shared") continue;
      const archivo = resolve(FUNCIONES, dir.name, "index.ts");
      if (!existsSync(archivo)) continue;

      const lineas = lineasConRubro(readFileSync(archivo, "utf8"));
      if (!lineas.length) continue;

      const permitido = TODAVIA_NOMBRAN_UN_RUBRO[dir.name];
      if (!permitido) {
        inesperados.push(`${dir.name} nombra un rubro y no está en la lista: ${lineas[0].slice(0, 80)}`);
        continue;
      }
      for (const linea of lineas) {
        if (!permitido.lineas.test(linea)) {
          inesperados.push(`${dir.name} tiene una línea nueva con rubro: ${linea.slice(0, 80)}`);
        }
      }
    }

    expect(
      inesperados,
      "una función nueva nombra un rubro. O lo resuelve con `leerPerfilDelComercio`, " +
        "o entra en TODAVIA_NOMBRAN_UN_RUBRO con el motivo escrito: " + inesperados.join(" | "),
    ).toEqual([]);
  });

  it("y esa lista no se queda con nombres que ya se limpiaron", () => {
    // El espejo: una entrada que sobra hace que la lista deje de significar
    // algo. Si una función se limpió, se saca de acá.
    const sobrantes = Object.keys(TODAVIA_NOMBRAN_UN_RUBRO).filter(fn => {
      const archivo = resolve(FUNCIONES, fn, "index.ts");
      return !existsSync(archivo) || lineasConRubro(readFileSync(archivo, "utf8")).length === 0;
    });
    expect(sobrantes, `ya no nombran un rubro y siguen en la lista: ${sobrantes.join(", ")}`).toEqual([]);
  });
});
