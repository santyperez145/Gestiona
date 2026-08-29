import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260824000001_api_keys_endurecidas.sql");
const contrato = leer("supabase/migrations/20260829000020_api_publica_tiene_contrato.sql");
const fn = leer("supabase/functions/public-api/index.ts");
const panel = leer("src/components/integrations/AdvancedApiKeysPanel.tsx");
const integraciones = leer("src/pages/IntegrationsPage.tsx");

/**
 * Guarda de la API pública.
 *
 * ── Lo que encontró la auditoría del 2026-08-24, verificado ───────────────
 *
 * La key vivía en TEXTO PLANO en `settings.api_key`, y `settings` tiene policy
 * SELECT para todos los miembros de la organización: cualquier empleado la leía
 * y con ella podía crear ventas, ajustar stock y rotar la key. Es el mismo
 * antipatrón que este repo ya erradicó para AFIP y MercadoPago.
 *
 * Había además dos sistemas paralelos que no autenticaban nada: `org_api_keys`
 * (hash correcto, sin backend) y `api_keys` con `key_hash = btoa(key)` — base64,
 * **reversible con atob()**. Y la key se generaba en el navegador.
 */
describe("la API pública no guarda la key en claro", () => {
  it("la Edge Function hashea antes de buscar", () => {
    expect(fn).toContain("sha256hex(apiKey)");
    expect(fn).toContain('.eq("key_hash", keyHash)');
  });

  it("ya NO autentica contra settings.api_key", () => {
    // Es el cambio central: esa columna la lee cualquier empleado.
    expect(fn).not.toContain('.eq("api_key", apiKey)');
    expect(fn).not.toMatch(/select\([^)]*api_key/);
  });

  it("la emisión es server-side y guarda sólo el hash", () => {
    expect(migracion).toContain("CREATE OR REPLACE FUNCTION public.api_key_emitir");
    expect(migracion).toContain("encode(sha256(convert_to(v_key, 'UTF8')), 'hex')");
    // La verificación comprueba explícitamente que no sea base64 reversible.
    expect(migracion).toContain("guardo base64, que es reversible");
  });

  it("la key ya no se genera en el navegador", () => {
    expect(panel).toContain('supabase.rpc("api_key_emitir"');
    expect(panel).not.toContain("generateMockKey");
    expect(panel).not.toContain("btoa(fullKey)");
    expect(integraciones).not.toContain("handleGenerateApiKey");
  });

  it("emitir y revocar exigen owner o admin en el servidor", () => {
    expect(migracion).toMatch(/api_key_emitir[\s\S]{0,900}has_org_role\(p_org, auth\.uid\(\), ARRAY\['owner','admin'\]\)/);
    expect(migracion).toMatch(/api_key_revocar[\s\S]{0,400}has_org_role/);
  });

  it("revocar marca, no borra", () => {
    // El historial de qué key existió y cuándo murió es parte de la auditoría.
    expect(migracion).toContain("SET revoked_at = COALESCE(revoked_at, now())");
    expect(migracion).not.toMatch(/api_key_revocar[\s\S]{0,300}DELETE FROM public\.api_keys/);
  });
});

describe("scopes: la key acota lo que puede hacer", () => {
  it("cada endpoint exige su scope", () => {
    for (const s of ["products:read", "stock:read", "stock:write", "sales:read", "sales:write", "customers:read"]) {
      expect(fn).toContain(`tiene("${s}")`);
    }
  });

  it("el costo sólo sale con costs:read", () => {
    // El costo de la mercadería es el dato más sensible del negocio: con él se
    // deduce el margen de cada producto.
    expect(fn).toMatch(/tiene\("costs:read"\)[\s\S]{0,120}cost_usd/);
    // Y la rama sin el scope no lo incluye.
    expect(fn).toContain('...(tiene("costs:read") ? ["cost_usd"] : [])');
    expect(fn).toContain("publicProduct(");
    expect(fn).toContain('tiene("costs:read"),');
  });

  it("la lista de scopes de la UI es la que el servidor acepta", () => {
    // Si se desincronizan, el usuario cree acotar una key y no acota nada —
    // que es lo que pasaba con invoices:write y users:read.
    for (const s of ["products:read", "stock:write", "sales:write", "costs:read"]) {
      expect(panel).toContain(`"${s}"`);
      expect(migracion).toContain(`'${s}'`);
    }
    // Los scopes fantasma no vuelven a la lista. Se mira SOLO el array: el
    // comentario que explica por qué se fueron los nombra, y buscarlos en todo
    // el archivo haría fallar al test por su propia documentación.
    const lista = panel.slice(panel.indexOf("const ALL_SCOPES"), panel.indexOf("SCOPE_DESC"));
    for (const fantasma of ["invoices:write", "users:read", "expenses:write", "reports:read"]) {
      expect(lista).not.toContain(fantasma);
    }
  });

  it("un scope desconocido se rechaza al emitir", () => {
    expect(migracion).toContain("Scope desconocido");
  });

  it("no se puede emitir una key sin scopes", () => {
    expect(migracion).toContain("La key necesita al menos un scope");
    expect(panel).toContain("una key sin scopes no puede hacer nada");
  });
});

describe("escrituras y errores", () => {
  it("POST /sales acepta Idempotency-Key", () => {
    // Un retry de red duplicaba la venta y su descuento de stock.
    expect(fn).toContain('req.headers.get("Idempotency-Key")');
    expect(fn).toContain('err("Idempotency-Key header required"');
    expect(fn).toContain('rpc("api_v1_crear_venta"');
    expect(contrato).toContain("v_operation text := 'api_create_sale:' || p_api_key_id::text");
    expect(fn).toContain("idempotent_replay");
  });

  it("un product_id inválido NO deja la clave de idempotencia trabada", () => {
    // El 404 de producto va ANTES de reservar. Al revés, la clave quedaba
    // `en_curso` y el reintento —aun corregido— chocaba 24 h contra un 409 por
    // una request que nunca escribió nada.
    expect(contrato.indexOf("SELECT * INTO v_product")).toBeLessThan(
      contrato.indexOf("public.idempotencia_reservar("),
    );
  });

  it("la venta y la idempotencia viven en una sola transacción SQL", () => {
    expect(contrato).toContain("CREATE OR REPLACE FUNCTION public.api_v1_crear_venta");
    expect(contrato).toContain("INSERT INTO public.sales");
    expect(contrato).toContain("public.idempotencia_completar(");
    expect(fn).not.toContain('rpc("idempotencia_reservar"');
    expect(fn).not.toContain('rpc("idempotencia_completar"');
  });

  it("distingue clave reusada de operación en curso", () => {
    expect(fn).toContain("idempotency_conflict");
    expect(fn).toContain("idempotency_in_progress");
  });

  it("quantity exige entero positivo, como el PATCH de stock", () => {
    // Antes "abc" pasaba el truthy check, NaN <= 0 daba false, y se insertaba
    // quantity NaN.
    expect(fn).toContain("!Number.isInteger(quantity) || quantity <= 0");
  });

  it("el stock lo mueve la base, no la función", () => {
    expect(fn).toContain('supabase.rpc("adjust_stock"');
    expect(fn).not.toMatch(/from\("products"\)[\s\S]{0,80}\.update\(\{[\s\S]{0,60}stock/);
  });

  it("no filtra el error de Postgres al cliente", () => {
    // Un mensaje crudo revela nombres de constraints, triggers y columnas.
    expect(fn).toContain("const dbErr = (");
    expect(fn).toContain("Internal error (request");
    expect(fn).not.toContain("err(error.message, 500)");
  });

  it("un fallo de DB en la auth NO se reporta como key inválida", () => {
    // Son problemas opuestos: confundirlos deja al integrador revisando su key
    // mientras la base está caída.
    expect(fn).toContain("if (keyErr) return dbErr(");
  });

  it("distingue key inválida, revocada y vencida", () => {
    expect(fn).toContain("revoked_api_key");
    expect(fn).toContain("expired_api_key");
  });
});

describe("superficie", () => {
  it("sin CORS abierto: es server-to-server", () => {
    // Allow-Origin:* invita a usar la key desde JS de navegador, donde queda
    // expuesta a cualquiera que abra las devtools.
    expect(fn).not.toContain('"Access-Control-Allow-Origin": "*"');
    expect(fn).not.toContain("rateLimitResponse()");
  });

  it("una versión desconocida da 404 en vez de mapear a v1", () => {
    // El regex anterior aceptaba /v99/ y lo servía como v1: un cliente que
    // apuntara a una versión futura recibiría otra semántica sin enterarse.
    expect(fn).toContain("unknown_version");
  });

  it("no expone select(*) del producto", () => {
    // Con el asterisco, cualquier columna sensible que se agregue mañana se
    // filtra sola a las integraciones.
    expect(fn).not.toContain('.select("*")');
  });

  it("el sistema de keys que no autenticaba nada se eliminó", () => {
    expect(existsSync(resolve(ROOT, "src/components/shared/ApiKeysManager.tsx"))).toBe(false);
    expect(integraciones).not.toContain("ApiKeysManager");
    expect(migracion).toContain("DEPRECADA");
  });

  it("la señal de configurado mira la tabla canónica, no la columna deprecada", () => {
    // settings.api_key quedó siempre NULL: el panel habría dicho "sin
    // configurar" con keys funcionando.
    expect(integraciones).toContain("keysVivas");
    expect(integraciones).not.toContain("settings?.api_key");
  });
});
