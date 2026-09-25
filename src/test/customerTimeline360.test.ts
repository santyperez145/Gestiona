import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const src = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/**
 * Guardias del timeline 360 del cliente.
 *
 * El problema: la ficha 360 tenía cada fuente en su tab y el comercio tenía
 * que recorrerlas todas para responder "¿qué pasó con este cliente y cuándo?".
 * La respuesta es una lectura unificada server-side, no una tabla nueva ni
 * otro source of truth.
 */
describe("timeline 360 del cliente", () => {
  it("la migración crea la RPC con autoridad en servidor, sin tablas nuevas", () => {
    const mig = src("supabase/migrations/20260925000700_customer_timeline_360.sql");
    expect(mig).toContain("CREATE OR REPLACE FUNCTION public.customer_timeline_360");
    // Autoridad: miembro de la org + permiso customers:view; el cliente nunca declara al cliente.
    expect(mig).toContain("public.is_org_member(p_org_id, v_user)");
    expect(mig).toContain("public.has_permission(p_org_id, 'customers', 'view')");
    // La ficha pedida tiene que ser de la org pedida: un id de otra org es error, no escape.
    expect(mig).toContain("WHERE id = p_customer_id AND org_id = p_org_id");
    // Sin acceso anónimo.
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.customer_timeline_360(uuid, uuid, int, int) FROM PUBLIC, anon");
    // No crea tablas: es una lectura sobre lo que ya existe.
    expect(mig).not.toContain("CREATE TABLE");
  });

  it("cubre las fuentes prometidas, no un subconjunto", () => {
    const mig = src("supabase/migrations/20260925000700_customer_timeline_360.sql");
    expect(mig).toContain("FROM public.sales s");
    expect(mig).toContain("FROM public.ecommerce_orders o");
    expect(mig).toContain("FROM public.customer_communications c");
    expect(mig).toContain("FROM public.birthday_whatsapp_deliveries b");
    expect(mig).toContain("FROM public.debts d");
    expect(mig).toContain("FROM public.crm_followups f");
  });

  it("el cruce es el mismo que la ficha ya usa y declara la evidencia", () => {
    const mig = src("supabase/migrations/20260925000700_customer_timeline_360.sql");
    // Mismo normalize que el trigger: una divergencia mostraría dos historias.
    expect(mig).toContain("public.normalize_person_name");
    // El fallback por nombre es explícito, no silencioso: linked_by.
    expect(mig).toContain("linked_by");
    expect(mig).toContain("'nombre' END");
  });

  it("la verificación reversible existe y prueba aislamiento y autoridad", () => {
    const verify = src("supabase/verificaciones/20260925_customer_timeline_360.sql");
    expect(verify).toContain("ROLLBACK");
    expect(verify).toContain("rollback_intencional");
    // Un homónimo de otra org no puede leerse.
    expect(verify).toContain("se leyó un cliente de otra org");
    // Un no-miembro no lee la org.
    expect(verify).toContain("un no-miembro leyó la timeline de la org");
    // El cruce por nombre se reporta, no se presupone.
    expect(verify).toContain("linked_by = nombre");
  });

  it("el cliente va por RPC y traduce errores legibles", () => {
    const db = src("src/lib/crmTimelineDB.ts");
    expect(db).toContain("customer_timeline_360");
    expect(db).toContain("timelineErrorMessage");
    expect(db).toContain("customers_permission_denied");
    // Paginación acotada server-side.
    expect(db).toContain("TIMELINE_PAGE_SIZE");
  });

  it("la ficha 360 monta la timeline en sus dos vistas", () => {
    const page = src("src/pages/CustomersPage.tsx");
    expect(page).toContain("import CustomerTimeline360");
    // Tab Resumen y vista expandida: los dos caminos de lectura de la ficha.
    expect(page).toContain("<CustomerTimeline360 orgId={activeOrg.id} customerId={c.customerId} />");
  });

  it("el componente cubre los estados del contrato, no sólo el éxito", () => {
    const comp = src("src/components/customers/CustomerTimeline360.tsx");
    // loading / vacío / error con reintento / éxito, como pide el DoD.
    expect(comp).toContain('kind="initial-loading"');
    expect(comp).toContain('kind="empty-first-use"');
    expect(comp).toContain('kind="error-recoverable"');
    expect(comp).toContain("Reintentar");
    // Sin ficha en el CRM no puede pedir el timeline (el RPC exige customer_id real).
    expect(comp).toContain("if (!customerId) return null;");
  });
});