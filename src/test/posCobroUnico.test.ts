import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  atajoBloqueadoPorDialogo,
  avisoDeNuevaVenta,
  cerrarCobroQrAcreditado,
  cobrarUnaSolaVez,
  cobroBloqueado,
  contextoParaReanudarQr,
  crearCandadoDeCobro,
  esVentaPropia,
  hayDialogoModalAbierto,
  marcarVentasPropias,
  VIGENCIA_MARCA_QR_MS,
} from "@/lib/posCobroUnico";

// 2026-11-04: después de cobrar online el carrito no se vaciaba y F9 seguía
// cobrando con el recibo abierto: la misma venta se registraba dos veces
// (doble ingreso y doble descuento de stock).

const pos = readFileSync(resolve(process.cwd(), "src/pages/POSPage.tsx"), "utf8");
const kpis = readFileSync(resolve(process.cwd(), "src/hooks/useRealtimeKPIs.ts"), "utf8");

/**
 * 2026-11-04: caja con cobro QR. Igual que POSPage: pedir el QR toma el ciclo,
 * el cobro (y su candado) termina cuando el QR queda esperando, y al
 * acreditarse el diálogo se cierra antes de los awaits largos (auditoría,
 * factura en ARCA, refresco del catálogo) que recién al final vacían el carrito.
 */
function cajaConQr() {
  const base = { pedidosQr: 0, ventas: 0, stock: 10, ingreso: 0 };
  const estado = { carrito: [{ cantidad: 1, precio: 12_500 }], dialogoQr: false, recibo: false };
  const candado = crearCandadoDeCobro();
  const cicloQr = crearCandadoDeCobro();
  let terminarCierre: () => void = () => {};

  const confirmar = () => cobrarUnaSolaVez(
    candado,
    () => !cobroBloqueado({
      renglones: estado.carrito.length,
      registrando: false,
      reciboAbierto: estado.recibo,
      cobroQrAbierto: estado.dialogoQr || cicloQr.tomado,
    }),
    async () => {
      // requestQrOrder: toma el ciclo, reserva stock y deja el QR esperando.
      cicloQr.tomar();
      base.pedidosQr += 1;
      estado.dialogoQr = true;
    },
  );

  const acreditar = () => cerrarCobroQrAcreditado(cicloQr, () => { estado.dialogoQr = false; }, async () => {
    await new Promise<void>((ok) => { terminarCierre = ok; });
    base.ventas += 1;
    for (const r of estado.carrito) {
      base.stock -= r.cantidad;
      base.ingreso += r.cantidad * r.precio;
    }
    estado.recibo = true;
    estado.carrito = [];
  });

  const cancelar = () => {
    estado.dialogoQr = false;
    cicloQr.soltar();
  };

  return { base, estado, candado, cicloQr, confirmar, acreditar, cancelar, terminarCierre: () => terminarCierre() };
}

/**
 * 2026-11-04: QR en vivo que cae en revisión manual y se vuelve a consultar
 * («Consultar el mismo cobro»). Igual que POSPage: el contexto reanudado sale
 * de `contextoParaReanudarQr`; un QR recuperado no toca el ciclo ni el carrito.
 */
function cajaConQrEnRevision() {
  type Renglon = { cantidad: number; precio: number };
  type Contexto = { recovered?: boolean; carrito: Renglon[] };
  const base = { ventas: 0, stock: 10, ingreso: 0 };
  const ciclo = crearCandadoDeCobro();
  const estado = {
    carrito: [{ cantidad: 1, precio: 12_500 }] as Renglon[],
    dialogo: null as Contexto | null,
    recibo: false,
  };
  const registrarEnServidor = (carrito: Renglon[]) => {
    base.ventas += 1;
    for (const r of carrito) {
      base.stock -= r.cantidad;
      base.ingreso += r.cantidad * r.precio;
    }
  };
  const pedir = () => {
    ciclo.tomar();
    estado.dialogo = { carrito: estado.carrito };
  };
  const reanudar = () => {
    estado.dialogo = contextoParaReanudarQr(estado.dialogo, { recovered: true, carrito: [] });
  };
  const acreditar = async () => {
    const ctx = estado.dialogo!;
    registrarEnServidor(ctx.carrito);
    if (ctx.recovered) {
      estado.dialogo = null;
      return;
    }
    await cerrarCobroQrAcreditado(ciclo, () => { estado.dialogo = null; }, async () => {
      estado.recibo = true;
      estado.carrito = [];
    });
  };
  const cerrarParaRevisar = () => {
    const ctx = estado.dialogo!;
    estado.dialogo = null;
    if (!ctx.recovered) ciclo.soltar();
  };
  const puedeCobrar = () => !cobroBloqueado({
    renglones: estado.carrito.length,
    registrando: false,
    reciboAbierto: estado.recibo,
    cobroQrAbierto: estado.dialogo !== null || ciclo.tomado,
  });
  return { base, ciclo, estado, pedir, reanudar, acreditar, cerrarParaRevisar, puedeCobrar };
}

/** Caja mínima: un carrito, un recibo y una base que cuenta ventas y stock. */
function cajaDePrueba() {
  const base = { ventas: 0, stock: 10, ingreso: 0 };
  const estado = { carrito: [{ cantidad: 1, precio: 12_500 }], registrando: false, recibo: false };
  const candado = crearCandadoDeCobro();
  let liberarBase: () => void = () => {};

  const registrar = async () => {
    estado.registrando = true;
    // La base tarda: es la ventana en la que entraba el segundo F9.
    await new Promise<void>((ok) => { liberarBase = ok; });
    base.ventas += 1;
    for (const r of estado.carrito) {
      base.stock -= r.cantidad;
      base.ingreso += r.cantidad * r.precio;
    }
    estado.recibo = true;
    estado.carrito = [];
    estado.registrando = false;
  };

  // `registrando` se lee "tarde", como el estado de React: el candado no depende de él.
  const confirmar = () => cobrarUnaSolaVez(
    candado,
    () => !cobroBloqueado({ renglones: estado.carrito.length, registrando: false, reciboAbierto: estado.recibo, cobroQrAbierto: false }),
    registrar,
  );

  return { base, estado, confirmar, terminarBase: () => liberarBase() };
}

describe("un cobro, una venta", () => {
  it("un segundo confirmar mientras la venta se registra no crea otra venta", async () => {
    const caja = cajaDePrueba();
    const primero = caja.confirmar();
    const segundo = caja.confirmar();
    caja.terminarBase();

    await expect(primero).resolves.toBe(true);
    await expect(segundo).resolves.toBe(false);
    expect(caja.base).toEqual({ ventas: 1, stock: 9, ingreso: 12_500 });
  });

  it("con el recibo abierto, F9 no repite la venta", async () => {
    const caja = cajaDePrueba();
    const primero = caja.confirmar();
    caja.terminarBase();
    await primero;

    expect(caja.estado.recibo).toBe(true);
    expect(caja.estado.carrito).toEqual([]);
    await expect(caja.confirmar()).resolves.toBe(false);
    expect(caja.base).toEqual({ ventas: 1, stock: 9, ingreso: 12_500 });
  });

  it("si la venta falla, el candado se suelta y se puede reintentar", async () => {
    const candado = crearCandadoDeCobro();
    const falla = vi.fn(async () => { throw new Error("sin conexión"); });
    await expect(cobrarUnaSolaVez(candado, () => true, falla)).rejects.toThrow("sin conexión");
    expect(candado.tomado).toBe(false);
    const ok = vi.fn(async () => {});
    await expect(cobrarUnaSolaVez(candado, () => true, ok)).resolves.toBe(true);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("QR acreditado: un confirmar mientras se registra la venta no arma otro QR", async () => {
    const caja = cajaConQr();
    await expect(caja.confirmar()).resolves.toBe(true);
    // El cobro terminó (QR esperando): el candado del cobro ya está libre.
    expect(caja.candado.tomado).toBe(false);
    expect(caja.cicloQr.tomado).toBe(true);

    const cierre = caja.acreditar();
    // Diálogo cerrado, recibo todavía no, carrito lleno: la ventana del doble cobro.
    expect(caja.estado.dialogoQr).toBe(false);
    expect(caja.estado.recibo).toBe(false);
    expect(caja.estado.carrito).toHaveLength(1);
    await expect(caja.confirmar()).resolves.toBe(false);

    caja.terminarCierre();
    await cierre;
    expect(caja.cicloQr.tomado).toBe(false);
    await expect(caja.confirmar(), "con el recibo abierto y el carrito vacío").resolves.toBe(false);
    expect(caja.base).toEqual({ pedidosQr: 1, ventas: 1, stock: 9, ingreso: 12_500 });
  });

  it("QR cancelado: el ciclo se suelta y se puede cobrar de nuevo el mismo carrito", async () => {
    const caja = cajaConQr();
    await caja.confirmar();
    await expect(caja.confirmar(), "con el QR esperando").resolves.toBe(false);
    caja.cancelar();
    expect(caja.cicloQr.tomado).toBe(false);
    await expect(caja.confirmar()).resolves.toBe(true);
    expect(caja.base.pedidosQr).toBe(2);
    expect(caja.base.ventas).toBe(0);
  });

  it("si registrar la venta QR falla, el ciclo igual se suelta", async () => {
    const ciclo = crearCandadoDeCobro();
    ciclo.tomar();
    const cerrar = vi.fn();
    await expect(cerrarCobroQrAcreditado(ciclo, cerrar, async () => { throw new Error("ARCA caída"); }))
      .rejects.toThrow("ARCA caída");
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(ciclo.tomado).toBe(false);
  });

  it("la caja sostiene el ciclo QR desde el pedido hasta registrar la venta o cancelar", () => {
    const pedido = pos.slice(pos.indexOf("const requestQrOrder = async"), pos.indexOf("const resumeRecoveredQr"));
    expect(pedido.indexOf("cicloQrRef.current.tomar();")).toBeGreaterThan(-1);
    expect(pedido.indexOf("cicloQrRef.current.tomar();")).toBeLessThan(pedido.indexOf("setQrCheckout(preparing)"));

    const fin = pos.slice(pos.indexOf("const finalizeQrSale = async"), pos.indexOf("const requestQrOrder = async"));
    const antes = fin.slice(0, fin.indexOf("cerrarCobroQrAcreditado("));
    const vivo = fin.slice(fin.indexOf("cerrarCobroQrAcreditado("));
    expect(fin).toContain("await cerrarCobroQrAcreditado(cicloQrRef.current, () => setQrCheckout(null), async () => {");
    // Antes del ciclo sólo se cierra el diálogo de un QR recuperado, nunca el de uno en vivo.
    expect(antes).not.toContain("setQrCheckout(null)");
    expect(antes).toContain("setQrCheckout((previous) => (previous && !previous.recovered ? previous : null));");
    // La venta se registra adentro del ciclo.
    expect(vivo.indexOf("await finishOnlineSaleUi(")).toBeGreaterThan(-1);
    expect(vivo.indexOf("await finishOnlineSaleUi(")).toBeLessThan(vivo.indexOf("acknowledgeQrSession"));

    const cancelar = pos.slice(pos.indexOf("const cerrarQrSinVenta = "), pos.indexOf("useEffect(() => {", pos.indexOf("const cancelQrCheckout")));
    expect(cancelar).toContain("if (!checkout.recovered) cicloQrRef.current.soltar();");
    // 2026-11-04: el QR en vivo que se vuelve a consultar desde la revisión
    // manual no se convierte en recuperado (si no, nadie soltaba el ciclo).
    const reintento = pos.slice(pos.indexOf("const retryQrOrder = async"), pos.indexOf("const setupQrPos = async"));
    expect(reintento).toContain("await resumeRecoveredQr(checkout.session, checkout);");
    const reanudar = pos.slice(pos.indexOf("const resumeRecoveredQr = async"), pos.indexOf("const retryQrOrder = async"));
    expect(reanudar).toContain("contextoParaReanudarQr<QrCheckoutContext>(delCicloEnVivo, {");
    expect(cancelar.split("cerrarQrSinVenta(checkout);").length - 1, "los tres cierres sin venta sueltan el ciclo").toBe(3);
    expect(cancelar.split("setQrCheckout(null);").length - 1, "sólo adentro de cerrarQrSinVenta").toBe(1);
    expect(pos).toContain("cobroQrAbierto: qrCheckout !== null || cicloQrRef.current.tomado,");
    expect(pos).toContain("cicloQrRef.current.tomado ||");
  });

  it("QR en vivo en revisión manual: al volver a consultarlo y acreditarse, una sola venta y el ciclo libre", async () => {
    const caja = cajaConQrEnRevision();
    caja.pedir();
    caja.reanudar();
    expect(caja.estado.dialogo?.recovered, "sigue siendo el QR en vivo").toBeUndefined();
    await caja.acreditar();
    expect(caja.ciclo.tomado).toBe(false);
    expect(caja.estado.carrito).toEqual([]);
    expect(caja.estado.recibo).toBe(true);
    expect(caja.puedeCobrar()).toBe(false);
    caja.estado.recibo = false;
    expect(caja.puedeCobrar(), "el carrito quedó vacío: no hay nada que cobrar otra vez").toBe(false);
    expect(caja.base).toEqual({ ventas: 1, stock: 9, ingreso: 12_500 });
  });

  it("QR en vivo en revisión manual: «Cerrar para revisar» después de reconsultar suelta el ciclo", () => {
    const caja = cajaConQrEnRevision();
    caja.pedir();
    caja.reanudar();
    caja.cerrarParaRevisar();
    expect(caja.ciclo.tomado).toBe(false);
    expect(caja.estado.dialogo).toBeNull();
    // Con otro carrito la caja vuelve a cobrar: antes quedaba trabada hasta recargar.
    caja.estado.carrito = [{ cantidad: 2, precio: 1_000 }];
    expect(caja.puedeCobrar()).toBe(true);
    expect(caja.base.ventas).toBe(0);
  });

  it("un QR recuperado sin ciclo en vivo sigue siendo recuperado", () => {
    const recuperado = { recovered: true, ids: [] as string[] };
    expect(contextoParaReanudarQr(undefined, recuperado)).toBe(recuperado);
    expect(contextoParaReanudarQr({ recovered: true, ids: ["x"] }, recuperado)).toBe(recuperado);
    const enVivo = { ids: ["v-1"] } as { recovered?: boolean; ids: string[] };
    expect(contextoParaReanudarQr(enVivo, recuperado)).toBe(enVivo);
  });

  it("la marca de venta propia del QR cubre la espera del pago y se renueva", () => {
    vi.useFakeTimers();
    try {
      marcarVentasPropias(["qr-1"], VIGENCIA_MARCA_QR_MS);
      vi.advanceTimersByTime(5 * 60_000);
      // El servidor insertó la venta al acreditarse: el aviso llega antes del recibo.
      expect(avisoDeNuevaVenta([{ id: "qr-1", product_name: "Yerba", customer_name: null }], 3_000)).toBeNull();
      // Volver a marcar con menos vigencia no acorta la anterior.
      marcarVentasPropias(["qr-1"], 1_000);
      vi.advanceTimersByTime(2_000);
      expect(esVentaPropia("qr-1")).toBe(true);
      // Volver a marcar extiende.
      marcarVentasPropias(["corta"], 1_000);
      vi.advanceTimersByTime(900);
      marcarVentasPropias(["corta"], 1_000);
      vi.advanceTimersByTime(900);
      expect(esVentaPropia("corta")).toBe(true);
      vi.advanceTimersByTime(200);
      expect(esVentaPropia("corta")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("la caja marca la venta propia antes de crearla (online y QR)", () => {
    const online = pos.slice(pos.indexOf("const txSaleIds: string[] = [];"));
    expect(online.indexOf("marcarVentasPropias(txSaleIds);")).toBeGreaterThan(-1);
    expect(online.indexOf("marcarVentasPropias(txSaleIds);")).toBeLessThan(online.indexOf("await addSalesDB(transactionLines"));

    const pedido = pos.slice(pos.indexOf("const requestQrOrder = async"), pos.indexOf("const resumeRecoveredQr"));
    const marca = pedido.indexOf("marcarVentasPropias(checkout.saleIds, VIGENCIA_MARCA_QR_MS);");
    expect(marca).toBeGreaterThan(-1);
    expect(marca).toBeLessThan(pedido.indexOf('supabase.functions.invoke("mercadopago-pos-qr", {'));

    const sondeo = pos.slice(pos.indexOf('body: { action: "status", sessionId: checkout.session!.session_id }'));
    expect(sondeo.slice(0, sondeo.indexOf("qrPollBusyRef.current = false"))).toContain("marcarVentasPropias(checkout.saleIds, VIGENCIA_MARCA_QR_MS);");
  });

  it("bloquea el cobro sin carrito, registrando, con recibo o con QR abierto", () => {
    const base = { renglones: 1, registrando: false, reciboAbierto: false, cobroQrAbierto: false };
    expect(cobroBloqueado(base)).toBe(false);
    expect(cobroBloqueado({ ...base, renglones: 0 })).toBe(true);
    expect(cobroBloqueado({ ...base, registrando: true })).toBe(true);
    expect(cobroBloqueado({ ...base, reciboAbierto: true })).toBe(true);
    expect(cobroBloqueado({ ...base, cobroQrAbierto: true })).toBe(true);
  });

  it("con un diálogo abierto no corren los atajos que tocan el ticket", () => {
    expect(atajoBloqueadoPorDialogo("cobrar", true)).toBe(true);
    expect(atajoBloqueadoPorDialogo("vaciar_carrito", true)).toBe(true);
    expect(atajoBloqueadoPorDialogo("quitar_ultimo", true)).toBe(true);
    expect(atajoBloqueadoPorDialogo("cobrar", false)).toBe(false);
    expect(atajoBloqueadoPorDialogo("escape", true)).toBe(false);
    const conDialogo = { querySelector: (s: string) => (s.includes('data-state="open"') ? ({} as Element) : null) };
    expect(hayDialogoModalAbierto(conDialogo)).toBe(true);
    expect(hayDialogoModalAbierto({ querySelector: () => null })).toBe(false);
  });

  it("recuerda las ventas propias para no repetir el aviso en tiempo real", () => {
    vi.useFakeTimers();
    try {
      marcarVentasPropias(["venta-1"], 1_000);
      expect(esVentaPropia("venta-1")).toBe(true);
      expect(esVentaPropia("otra")).toBe(false);
      expect(esVentaPropia(null)).toBe(false);
      vi.advanceTimersByTime(1_001);
      expect(esVentaPropia("venta-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("el aviso en vivo calla la venta propia y no inventa «Cliente»", () => {
    vi.useFakeTimers();
    try {
      marcarVentasPropias(["propia-1", "propia-2"], 1_000);
      const renglon = (id: string, customer_name: string | null = null) => ({ id, product_name: "Yerba", customer_name });
      expect(avisoDeNuevaVenta([renglon("propia-1"), renglon("propia-2")], 5_000)).toBeNull();
      expect(avisoDeNuevaVenta([renglon("ajena")], 5_000)).toEqual({
        titulo: `💰 Nueva venta: $${(5_000).toLocaleString("es-AR")}`,
        descripcion: "Yerba",
      });
      expect(avisoDeNuevaVenta([renglon("ajena", "Ana")], 5_000)?.descripcion).toBe("Yerba · Ana");
      expect(avisoDeNuevaVenta([renglon("ajena", "  ")], 5_000)?.descripcion).toBe("Yerba");
      expect(avisoDeNuevaVenta([renglon("ajena", "Ana"), renglon("propia-1")], 9_000)?.descripcion).toBe("2 productos · Ana");
      expect(avisoDeNuevaVenta([], 1_000)?.descripcion).toBe("Venta");
    } finally {
      vi.useRealTimers();
    }
  });

  it("el hook sigue contando la venta propia aunque no avise", () => {
    const venta = kpis.slice(kpis.indexOf('useTopicEvent(topic, "venta"'), kpis.indexOf('useTopicEvent(topic, "stock"'));
    expect(venta).toContain("avisoDeNuevaVenta(ventas, total)");
    expect(venta.indexOf("setSaleEventCount(n => n + 1);")).toBeLessThan(venta.indexOf("avisoDeNuevaVenta("));
    expect(venta.indexOf("setLastSale(")).toBeLessThan(venta.indexOf("if (!conAviso) return;"));
    expect(kpis).toContain("opts: { toast?: boolean } = {}");
  });

  it("la caja vacía el carrito al cerrar la venta online y bloquea F9 con el recibo abierto", () => {
    const fin = pos.slice(pos.indexOf("const finishOnlineSaleUi = async ("), pos.indexOf("const acknowledgeQrSession"));
    expect(fin).toContain("clearCart();");
    expect(fin.indexOf("clearCart();")).toBeGreaterThan(fin.indexOf("setTurnoSales("));
    expect(fin).toContain("marcarVentasPropias(saleIds)");
    expect(fin, "el recibo confirma la venta; el toast lo tapaba").not.toContain("toast.success(`Venta de");
    expect(pos).toContain("await cobrarUnaSolaVez(");
    expect(pos).toContain("receipt !== null ||");
    expect(pos).toContain("qrCheckout !== null ||");
    expect(pos).toContain("atajoBloqueadoPorDialogo(accion, hayDialogoModalAbierto(document))");
    // El recibo no lee el carrito vivo: si no, al vaciarlo diría «Efectivo» y sin cliente.
    expect(pos).toContain("payMethod={receipt.pago.payMethod}");
    expect(pos).toContain("customer={receipt.pago.customer}");
  });

  it("la caja usa el tema global y muestra el vuelto en el pie fijo", () => {
    expect(pos).not.toContain("posTheme");
    expect(pos).not.toContain("togglePosTheme");
    const footer = pos.slice(pos.indexOf("pos-cart-footer shrink-0"));
    expect(footer).toContain("pos-cash-quick");
    expect(footer).toContain("Vuelto: ");
    expect(footer.indexOf("pos-cash-quick")).toBeLessThan(footer.indexOf("pos-confirm-sale"));
  });

  it("el resumen local no habla de la pestaña del navegador ni aprieta el buscador", () => {
    expect(pos).not.toContain("Esta pestaña · {turnoSales.length}");
    expect(pos).toContain("Recién vendidas · {turnoSales.length}");
    expect(pos).toContain("hidden 2xl:flex items-center gap-1.5 shrink-0 text-xs text-primary");
    expect(pos).toContain('toast.dismiss("first-product-handoff")');
  });
});
