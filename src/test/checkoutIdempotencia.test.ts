import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260816000001_idempotencia.sql");
const envoltorio = leer("supabase/migrations/20260816000002_checkout_idempotente.sql");
const checkout = leer("src/storefront/StoreCheckout.tsx");
const fuente = leer("src/lib/publicDataSource.ts");

/**
 * H1 — guarda de la idempotencia del checkout.
 *
 * Estas propiedades no se pueden verificar con un test unitario común porque
 * viven en SQL, pero son exactamente las que si se pierden vuelven a permitir
 * cobrar dos veces. El costo de este archivo es que un refactor las tenga que
 * romper a propósito.
 */
describe("idempotencia del checkout", () => {
  it("la misma clave con otro pedido es un ERROR, no la respuesta vieja", () => {
    // Es la decisión menos intuitiva y la más importante: devolver la respuesta
    // guardada ante un carrito distinto sería cobrarle lo que no pidió.
    expect(migracion).toContain("v_fila.request_hash <> v_hash");
    expect(migracion).toMatch(/RAISE EXCEPTION[\s\S]{0,120}ya se us/);
  });

  it("existe el estado en_curso, que es lo que frena la carrera", () => {
    // Sin un estado intermedio, dos requests simultáneos ven "no hay nada" y
    // los dos ejecutan.
    expect(migracion).toContain("'en_curso'");
    expect(migracion).toContain("55006");
  });

  it("una operación fallida se puede reintentar", () => {
    // Sin esto la clave queda trabada para siempre y el comprador no puede
    // volver a intentar: peor que el problema original.
    expect(migracion).toContain("idempotencia_fallar");
    expect(envoltorio).toContain("idempotencia_fallar");
  });

  it("las claves vencen, para que la tabla no crezca para siempre", () => {
    expect(migracion).toContain("expires_at");
    expect(migracion).toMatch(/expires_at < now\(\)/);
  });

  it("la tabla tiene RLS y ninguna policy: sólo la tocan funciones", () => {
    expect(migracion).toContain("ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY");
    expect(migracion).not.toMatch(/CREATE POLICY[\s\S]{0,80}idempotency_keys/);
  });

  it("la organización se resuelve del slug en el servidor, no la manda el navegador", () => {
    // Si la mandara el cliente, cualquiera podría reservar claves en la
    // organización ajena y dejarle el checkout bloqueado.
    expect(envoltorio).toContain("FROM public.ecommerce_stores s");
    expect(envoltorio).not.toMatch(/p_org(_id)?\s+uuid/);
  });

  it("el envoltorio NO reimplementa create_store_order", () => {
    // Reescribir 186 líneas de memoria es como casi se rompe
    // mark_store_order_paid. Tiene que llamarla, no copiarla.
    expect(envoltorio).toContain("v_resultado := public.create_store_order(");
    expect(envoltorio).not.toContain("INSERT INTO public.ecommerce_orders");
  });

  it("el checkout genera la clave una vez por intento, en un ref", () => {
    // En estado provocaría re-render; regenerada en cada llamada daría dos
    // claves para dos clics, que es justo lo que esto evita.
    expect(checkout).toContain("claveIdem = useRef");
    expect(checkout).toContain("if (!claveIdem.current) claveIdem.current = crypto.randomUUID()");
    expect(checkout).toContain("p_idempotency_key: claveIdem.current");
  });

  it("la clave se limpia recién cuando la orden se creó", () => {
    // Comprar de nuevo lo mismo es legítimo y tiene que poder hacerse.
    expect(checkout).toContain("claveIdem.current = null");
  });

  it("cae al camino viejo sólo si la función no existe todavía", () => {
    // El patrón del archivo: el cliente no puede asumir que la migración del
    // mismo commit ya se aplicó, pero tampoco tragarse un error real.
    expect(fuente).toContain("create_store_order_idem");
    expect(fuente).toContain("isMissingFunction(idem.error)");
  });
});
