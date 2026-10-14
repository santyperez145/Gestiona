import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

// Matriz POS, fila «Cuenta corriente» (2026-10-14): el cobro de fiado era leer
// → calcular en el navegador → escribir. Dos cajeros se pisaban, un reintento
// cobraba dos veces, «Cobrar todo» y «Marcar como pagadas» saldaban la deuda
// sin registrar el pago y nada entraba en la caja. Ahora todo pasa por
// `cobrar_cuenta_corriente` (atómica, idempotente por clave, FIFO, con caja).
const llamadas = vi.hoisted(() => ({ args: [] as Array<Record<string, unknown>>, fallar: new Set<string>() }));
vi.mock("@/lib/supabaseStore", () => ({
  cobrarCuentaCorrienteDB: async (a: Record<string, unknown>) => {
    llamadas.args.push(a);
    if (llamadas.fallar.has(String(a.debtId))) throw { message: "El pago (10,00) supera lo que se debe (5,00)", code: "22023" };
    return { cobro_id: `c-${llamadas.args.length}`, aplicado: a.monto, imputaciones: [], saldo_pendiente: 0, en_caja: true, repetido: false };
  },
}));

import { agruparDeudores, cobrarADeudor, cobrarSeleccion, excedenteDe, mensajeDeError, totalPendiente } from "@/lib/cuentaCorriente";

const deuda = (id: string, nombre: string | null, saldo: number | string, customer_id: string | null = null) =>
  ({ id, org_id: "org-1", customer_name: nombre, remaining_ars: saldo, customer_id });

describe("cuenta corriente: agrupar deudores", () => {
  it("agrupa por nombre sin espacios de más, suma al centavo y ordena de mayor a menor", () => {
    const g = agruparDeudores([
      deuda("a", "Ana ", 0.1), deuda("b", "Ana", 0.2), deuda("c", "Beto", 5), deuda("d", "  ", 99), deuda("e", null, 7),
    ]);
    expect(g.map(x => [x.nombre, x.total, x.deudas.length])).toEqual([["Beto", 5, 1], ["Ana", 0.3, 2]]);
  });

  it("cobra por cliente sólo si todas sus deudas son del mismo cliente; si no, por nombre", () => {
    const [mismo] = agruparDeudores([deuda("a", "Ana", 1, "cli-1"), deuda("b", "Ana", 2, "cli-1")]);
    expect(mismo.customerId).toBe("cli-1");
    const [mezcla] = agruparDeudores([deuda("a", "Ana", 1, "cli-1"), deuda("b", "Ana", 2, null)]);
    expect(mezcla.customerId).toBeNull();
    const [otra] = agruparDeudores([deuda("a", "Ana", 1, null), deuda("b", "Ana", 2, "cli-1")]);
    expect(otra.customerId).toBeNull();
  });

  it("el total pendiente se redondea al centavo", () => {
    expect(totalPendiente([deuda("a", "x", "0.1"), deuda("b", "x", 0.2)])).toBe(0.3);
  });
});

describe("cuenta corriente: cobrar", () => {
  beforeEach(() => { llamadas.args = []; llamadas.fallar = new Set(); });

  it("el pago a cuenta va con cliente, nombre, monto al centavo y la clave del intento", async () => {
    const [ana] = agruparDeudores([deuda("a", "Ana", 100, "cli-1")]);
    await cobrarADeudor(ana, { orgId: "org-1", monto: 33.333, medio: "efectivo", clave: "clave-0001", nota: "  " });
    expect(llamadas.args[0]).toEqual({
      orgId: "org-1", monto: 33.33, medio: "efectivo", clave: "clave-0001", customerId: "cli-1", customerName: "Ana", nota: null,
    });
  });

  it("cobrar las elegidas: una clave por deuda derivada del intento, y sigue aunque una falle", async () => {
    llamadas.fallar.add("b");
    const r = await cobrarSeleccion([deuda("a", "Ana", 10), deuda("b", "Beto", 10), deuda("c", "Caro", 5)], { medio: "transferencia", clave: "k-12345678" });
    expect(llamadas.args.map(a => a.clave)).toEqual(["k-12345678:a", "k-12345678:b", "k-12345678:c"]);
    expect(llamadas.args.every(a => a.debtId && a.medio === "transferencia")).toBe(true);
    expect(r.cobradas).toHaveLength(2);
    expect(r.fallidas.map(f => [f.deuda.id, f.error])).toEqual([["b", "El pago (10,00) supera lo que se debe (5,00)"]]);
  });

  it("reintentar con la misma clave repite exactamente los mismos pedidos (la base no cobra dos veces)", async () => {
    const elegidas = [deuda("a", "Ana", 10), deuda("b", "Beto", 10)];
    await cobrarSeleccion(elegidas, { medio: "efectivo", clave: "k-12345678" });
    const primera = llamadas.args.map(a => a.clave);
    llamadas.args = [];
    await cobrarSeleccion(elegidas, { medio: "efectivo", clave: "k-12345678" });
    expect(llamadas.args.map(a => a.clave)).toEqual(primera);
  });

  it("muestra el mensaje real de la base, venga como Error o como objeto", () => {
    expect(mensajeDeError(new Error("Sólo el dueño o un administrador pueden cobrar deudas"))).toBe("Sólo el dueño o un administrador pueden cobrar deudas");
    expect(mensajeDeError({ message: "No hay deudas pendientes para cobrar" })).toBe("No hay deudas pendientes para cobrar");
    expect(mensajeDeError(null)).toBe("No se pudo registrar el cobro");
  });
});

describe("cuenta corriente: nadie salda una deuda por fuera del cobro", () => {
  const pagina = fs.readFileSync("src/pages/DebtsPage.tsx", "utf8");
  const store = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");

  it("la pantalla de deudas no marca «pagada» a mano ni cobra sin clave", () => {
    expect(pagina).not.toMatch(/updateDebtDB\([^)]*status:\s*["']paid["']/);
    expect(pagina).toContain("addDebtPaymentDB(debt.id, payment, { orgId: debt.org_id, clave, paymentMethod })");
    expect(pagina).toContain('setCobro({ tipo: "seleccion", deudas: toMark })');
    expect(pagina).toContain('setCobro({ tipo: "cliente", deudor })');
  });

  it("el cobro de una deuda es la operación atómica de la base, no leer-calcular-escribir", () => {
    const cuerpo = store.slice(store.indexOf("export async function addDebtPaymentDB"), store.indexOf("// ========= SETTINGS"));
    expect(cuerpo).toContain("cobrarCuentaCorrienteDB(");
    expect(cuerpo).not.toMatch(/from\(['"]debts['"]\)/);
    expect(store).not.toMatch(/from\(['"]debt_payments['"]\)\.insert/);
  });

  it("la función de la base bloquea, es idempotente, exige permiso y no la llama cualquiera", () => {
    const sql = fs.readFileSync("supabase/migrations/20261014000500_cobro_de_cuenta_corriente.sql", "utf8");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("UNIQUE (org_id, clave)");
    expect(sql).toContain("has_org_role(p_org, v_user, ARRAY['owner', 'admin'])");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.cobrar_cuenta_corriente\([^)]*\) FROM PUBLIC, anon;/);
    expect(sql).toContain("INSERT INTO public.cash_entries");
  });
});

describe("cuenta corriente: el cajero cobra en el mostrador", () => {
  const pos = fs.readFileSync("src/pages/POSPage.tsx", "utf8");
  const lib = fs.readFileSync("src/lib/cuentaCorriente.ts", "utf8");

  it("la caja ofrece «Cobrar» sólo con un cliente elegido y lee sus deudas por id", () => {
    const aviso = pos.slice(pos.indexOf("pendiente de cobro</span>"), pos.indexOf('data-testid="pos-credit-available"'));
    expect(aviso).toContain("{posCustomerId && (");
    expect(aviso).toContain('data-testid="pos-cobrar-deuda"');
    expect(pos).toContain("deudorDelCliente(activeOrg.id, posCustomer.id, posCustomer.name)");
    const leer = lib.slice(lib.indexOf("export async function deudorDelCliente"));
    expect(leer).toContain('.eq("customer_id", customerId)');
    expect(leer).not.toContain("ilike");
    expect(leer).toContain("if (error) throw error;");
  });

  it("después de cobrar, la caja vuelve a leer lo que debe el cliente", () => {
    expect(pos).toContain("onDone={() => { setCobroDeuda(null); setRefrescoDeuda(n => n + 1); }}");
    expect(pos).toContain("}, [customer, activeOrg, posCustomerId, refrescoDeuda]);");
  });

  it("la base deja cobrar al vendedor sólo con caja abierta, y nunca al lector", () => {
    const sql = fs.readFileSync("supabase/migrations/20261014000600_cajero_cobra_fiado.sql", "utf8");
    expect(sql).toContain("v_es_admin OR public.has_org_role(p_org, v_user, ARRAY['vendedor'])");
    expect(sql).toContain("IF NOT v_es_admin AND v_sesion IS NULL THEN");
    expect(sql).toContain("USING ERRCODE = '55000'");
    expect(sql).not.toContain("'viewer'");
    // El reintento con la misma clave se resuelve antes de exigir caja.
    expect(sql.indexOf("RETURN v_previo || jsonb_build_object('repetido', true);")).toBeLessThan(sql.indexOf("IF NOT v_es_admin AND v_sesion IS NULL THEN"));
  });
});

describe("cuenta corriente: saldo a favor", () => {
  beforeEach(() => { llamadas.args = []; llamadas.fallar = new Set(); });
  const sql = fs.readFileSync("supabase/migrations/20261014000700_saldo_a_favor.sql", "utf8");
  const store = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");
  const form = fs.readFileSync("src/components/finance/CobroACuentaForm.tsx", "utf8");
  const pos = fs.readFileSync("src/pages/POSPage.tsx", "utf8");

  it("el excedente se calcula al centavo y nunca es negativo", () => {
    expect(excedenteDe(500, 300)).toBe(200);
    expect(excedenteDe(100.105, 100)).toBe(0.11);
    expect(excedenteDe(50, 300)).toBe(0);
    expect(excedenteDe(100, 0)).toBe(100);
  });

  it("dejar saldo a favor es explícito: sólo se pide cuando hay excedente", async () => {
    const [ana] = agruparDeudores([deuda("a", "Ana", 300, "cli-1")]);
    await cobrarADeudor(ana, { orgId: "org-1", monto: 500, medio: "efectivo", clave: "clave-0002", excedenteAFavor: true });
    expect(llamadas.args[0].excedenteAFavor).toBe(true);
    expect(store).toContain("...(args.excedenteAFavor ? { p_excedente_a_favor: true } : {}),");
  });

  it("la base: excedente sólo con cliente del negocio, saldo bloqueado y sin caja al usarlo", () => {
    expect(sql).toContain("IF (v_usa_saldo OR v_excedente) AND p_customer_id IS NULL THEN");
    expect(sql).toContain("FROM public.customers WHERE id = p_customer_id AND org_id = p_org FOR UPDATE;");
    expect(sql).toContain("IF v_usa_saldo AND v_monto > v_saldo + 0.005 THEN");
    expect(sql).toContain("IF v_monto > v_pendiente + 0.005 AND NOT v_excedente THEN");
    expect(sql).toMatch(/IF NOT v_usa_saldo THEN\s+SELECT id INTO v_sesion FROM public\.cash_sessions/);
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.cobrar_cuenta_corriente(uuid, numeric, text, text, uuid, text, uuid, text);");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.saldo_a_favor_movimientos FROM authenticated;");
    expect(sql).toContain("BEFORE DELETE ON public.customers");
  });

  it("el formulario muestra el excedente antes de confirmar y ofrece el saldo sólo si hay deuda", () => {
    expect(form).toContain('data-testid="cobro-excedente"');
    expect(form).toContain("objetivo.tipo === \"cliente\" && total > 0 && saldo !== null && saldo > 0.009 && (");
    expect(form).toContain("excedenteAFavor: aFavor > 0");
    expect(form).toContain("if (usaSaldo && monto > topeConSaldo + 0.005)");
  });

  it("la caja muestra el saldo del cliente y ofrece anticipo sólo si no debe nada", () => {
    expect(pos).toContain("setSaldoCliente(await saldoAFavorDB(activeOrg.id, posCustomerId))");
    const linea = pos.slice(pos.indexOf('data-testid="pos-saldo-a-favor"'), pos.indexOf('data-testid="pos-credit-available"'));
    expect(linea).toContain("{customerDebt === null && (");
    expect(linea).toContain("deudas: [], total: 0");
  });
});
