import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Las funciones que gastan plata verifican el plan en el servidor.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * `requireUser` garantiza que hay una persona real detrás del request. No dice
 * nada sobre si esa persona **pagó**. Hasta el 2026-08-27 ninguna función de IA
 * miraba el plan: un comercio con la suscripción vencida podía seguir quemando
 * crédito de Anthropic indefinidamente, porque el único corte estaba en el
 * navegador.
 *
 * Es la misma distinción que este repo ya escribió para permisos y para
 * `edgeFunctionAuth`: **la UI orienta, el servidor decide**.
 */

const ROOT = resolve(__dirname, "../..");
const FUNCS = resolve(ROOT, "supabase/functions");

/**
 * Funciones que gastan crédito de IA pero NO se cortan por el plan del
 * comercio. Cada una con el motivo escrito: una allowlist sin motivo es una
 * puerta abierta que nadie recuerda por qué se abrió.
 */
const SIN_PLAN_DEL_COMERCIO: Record<string, string> = {
  "platform-admin-action":
    "Es la consola de plataforma. La usa el staff del SaaS, que no tiene un " +
    "plan de comercio; su barrera es `is_platform_admin` + MFA.",
  "extract-finance-document":
    "Finance es un producto aparte con su propio gate en la base: " +
    "`finance_document_can` exige membresía, `organization_product_access` " +
    "habilitado y `has_permission(org,'finance',...)`. Cortarlo por " +
    "`ai_enabled` del plan de Gestión sería mezclar dos productos.",
};

function funcionesQueGastanIA(): string[] {
  return readdirSync(FUNCS, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("_"))
    .map(d => d.name)
    .filter(n => {
      const p = resolve(FUNCS, n, "index.ts");
      return existsSync(p) && readFileSync(p, "utf8").includes("ANTHROPIC_API_KEY");
    })
    .sort();
}

describe("el plan se verifica donde se gasta la plata", () => {
  it("toda función de IA exige el beneficio, o está en la allowlist con motivo", () => {
    const sinGate = funcionesQueGastanIA().filter(n => {
      if (n in SIN_PLAN_DEL_COMERCIO) return false;
      const src = readFileSync(resolve(FUNCS, n, "index.ts"), "utf8");
      // ⚠️ Se exige la LLAMADA, no el nombre: `import { exigirBeneficio }`
      // contiene la palabra y dejaba pasar una función con el gate anulado.
      // Verificado sustituyendo la llamada por `const sinPlan = null;` — con
      // `includes` el test seguía verde.
      return !/exigirBeneficio\s*\(/.test(src);
    });

    expect(
      sinGate,
      `estas funciones queman crédito de Anthropic sin mirar el plan: ${sinGate.join(", ")}. ` +
      "Agregá `exigirBeneficio(req, orgId, \"ia\", corsHeaders)` o documentá el motivo " +
      "en SIN_PLAN_DEL_COMERCIO.",
    ).toEqual([]);
  });

  it("la allowlist no acumula nombres de funciones que ya no existen", () => {
    const existentes = new Set(funcionesQueGastanIA());
    const huerfanas = Object.keys(SIN_PLAN_DEL_COMERCIO).filter(n => !existentes.has(n));
    expect(huerfanas, `sobran en la allowlist: ${huerfanas.join(", ")}`).toEqual([]);
  });
});

describe("la decisión no se escribe dos veces", () => {
  const helper = readFileSync(resolve(FUNCS, "_shared/entitlements.ts"), "utf8");

  it("el servidor pregunta a la base, no reimplementa la regla", () => {
    // La ventana de gracia, qué estado corta y el piso de límites viven en
    // `public.org_entitlements`. Si el helper los recalculara, tendríamos la
    // misma regla en tres lugares — que es como divergieron antes el mapa de
    // permisos y el reparto de roles.
    expect(helper, "el helper dejó de consultar la autoridad de la base")
      .toContain("org_entitlements");
    expect(helper, "el helper volvió a escribir la ventana de gracia a mano")
      .not.toMatch(/7\s*[-*]\s*dias|DIAS_DE_GRACIA/);
  });

  it("⚠️ consulta con el JWT del usuario, no con service_role", () => {
    /**
     * Con `service_role`, `auth.uid()` es NULL dentro de la función y el
     * chequeo de membresía se saltea: cualquiera podría mandar el `org_id` de
     * otro comercio para pedir prestado su plan. Con el JWT real, pedir por
     * una organización ajena devuelve `insufficient_privilege`.
     */
    expect(helper, "el helper empezó a usar la service role para leer el plan")
      .not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(helper, "el helper dejó de mandar el Authorization del usuario")
      .toContain("Authorization");
  });

  it("si no se puede verificar, corta", () => {
    // Dejar pasar ante la duda convierte cualquier hipo de la base en barra
    // libre sobre una API que se paga por llamada, y nadie se entera hasta la
    // factura.
    expect(helper, "el helper dejó de cortar cuando no puede verificar el plan")
      .toMatch(/if \(!e\)[\s\S]{0,300}?status: 503/);
  });

  it("y el hook del navegador lee esa misma función", () => {
    const hook = readFileSync(resolve(ROOT, "src/lib/useEntitlements.ts"), "utf8");
    // ⚠️ Se exige el RPC, no el nombre suelto: el archivo lo menciona en un
    // comentario, y con `toContain` el test quedaba verde aunque el hook
    // llamara a otra función. Es la misma trampa que ya se encontró en el
    // guardia de `ledger_plan_default`.
    expect(hook, "el hook volvió a decidir por su cuenta")
      .toMatch(/\.rpc\(\s*['"]org_entitlements['"]/);
  });
});

/**
 * El texto de la llamada donde aparece `nombreFn`, contando paréntesis desde
 * el `(` que la abre hasta el que la cierra.
 *
 * ⚠️ La primera versión de este test miraba una ventana fija de 900 caracteres
 * después del nombre. Se probó sacándole el `orgId` a `AIProactiveWidget` y
 * quedó verde: dentro de esa ventana había un `CACHE_KEY(orgId)` que no tiene
 * nada que ver con el cuerpo del request. Una ventana por caracteres no sabe
 * dónde termina la llamada; los paréntesis sí.
 */
function textoDeLaLlamada(src: string, nombreFn: string): string | null {
  const i = src.indexOf(nombreFn);
  if (i < 0) return null;
  const abre = src.lastIndexOf("(", i);
  if (abre < 0) return null;
  let nivel = 0;
  for (let j = abre; j < src.length; j++) {
    if (src[j] === "(") nivel++;
    else if (src[j] === ")") {
      nivel--;
      if (nivel === 0) return src.slice(abre, j + 1);
    }
  }
  return null;
}

describe("el comercio se entera de por qué se cortó", () => {
  /**
   * ⚠️ Se midió el 2026-08-27: **11 de 13** pantallas que llaman IA tapaban el
   * cuerpo del error con un genérico, porque `functions.invoke` descarta la
   * respuesta cuando el status no es 2xx. Con el gate puesto, el comercio
   * habría visto «Error al generar» en vez de «tu suscripción tiene un pago
   * pendiente» — un bug donde hay una decisión de producto.
   */
  const PANTALLAS = "src/components|src/pages";

  function archivosQueLlamanIA(): string[] {
    const IA = [
      "generate-description", "generate-social-copy", "ai-analysis",
      "predict-sales", "extract-invoice", "ai-deal-coach",
    ];
    const encontrados: string[] = [];
    const recorrer = (dir: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, d.name);
        if (d.isDirectory()) { recorrer(p); continue; }
        if (!d.name.endsWith(".tsx") && !d.name.endsWith(".ts")) continue;
        const src = readFileSync(p, "utf8");
        if (IA.some(n => src.includes(`"${n}"`) || src.includes(`'${n}'`))) {
          encontrados.push(p);
        }
      }
    };
    for (const raiz of PANTALLAS.split("|")) recorrer(resolve(ROOT, raiz));
    return encontrados;
  }

  it("ninguna pantalla llama IA con invoke crudo", () => {
    const crudas = archivosQueLlamanIA().filter(p => {
      const src = readFileSync(p, "utf8");
      // `ai-chat` va por fetch (SSE) y usa `motivoDeRespuesta`; el resto por
      // `llamarIA`. Lo que no puede quedar es un invoke a una función de IA
      // cuyo error se pierda.
      return /functions\.invoke\(\s*["'](generate-|ai-analysis|predict-sales|extract-invoice|ai-deal-coach)/.test(src)
        && !src.includes("mensajeDeEdgeFunction");
    }).map(p => p.replace(ROOT, "").replace(/\\/g, "/"));

    expect(
      crudas,
      `estas pantallas se tragan el motivo del error (incluido el 402 de plan): ${crudas.join(", ")}. ` +
      "Usá `llamarIA` de src/lib/ia.ts.",
    ).toEqual([]);
  });

  it("las funciones que reciben la organización la reciben de verdad", () => {
    /**
     * ⚠️ El gate corta con 400 si no le llega `orgId`. Una pantalla que no lo
     * manda no queda "sin verificar": queda **rota**, y para el comercio se ve
     * igual que no tener plan. Esta es la mitad del test que evita cortar de
     * más — la otra mitad, que sin plan se corte, la prueba la migración.
     */
    const conOrg = ["generate-description", "generate-social-copy", "ai-analysis",
                    "predict-sales", "extract-invoice"];
    const faltan: string[] = [];
    for (const p of archivosQueLlamanIA()) {
      const src = readFileSync(p, "utf8");
      for (const fn of conOrg) {
        if (!src.includes(`"${fn}"`) && !src.includes(`'${fn}'`)) continue;
        const llamada = textoDeLaLlamada(src, fn);
        if (llamada !== null && !/orgId/.test(llamada)) {
          faltan.push(`${p.replace(ROOT, "").replace(/\\/g, "/")} → ${fn}`);
        }
      }
    }
    expect(faltan, `no mandan orgId y el servidor las va a cortar con 400: ${faltan.join(", ")}`)
      .toEqual([]);
  });
});
