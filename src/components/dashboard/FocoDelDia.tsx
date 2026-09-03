/**
 * La primera pantalla del panel: qué contestar antes de mostrar cuarenta bloques.
 *
 * El dashboard abría con la cotización del dólar y una fila de accesos rápidos,
 * y recién después —scrolleando— aparecían las ventas. Este bloque va arriba de
 * todo y contesta, en este orden:
 *
 *   1. ¿Cómo viene el mes?    un número grande y la comparación
 *   2. ¿Qué tengo que hacer?  una lista corta, ordenada por costo de no hacerlo
 *
 * La lógica de qué es un pendiente y en qué orden va vive en
 * `src/lib/dashboardFocus.ts`, que es puro y tiene tests.
 *
 * No recalcula nada: todo sale del `stats` que el panel ya computa. Las
 * consultas propias son pedidos por despachar, pendientes de pago, ritmo de
 * ventas, toma física y ofertas IA — lo que el panel no traía y es accionable.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  construirPendientes, leerVariacion, nivelDelDia,
  type DatosFoco, type Urgencia,
} from "@/lib/dashboardFocus";
import { countActionableUnpaidOrders } from "@/lib/storeOrderPayment";
import { countFulfillmentPulse } from "@/lib/storeOrderQueue";
import { ArrowUp, ArrowDown, Minus, AlertTriangle, AlertCircle, Circle, Check, ArrowRight } from "lucide-react";

const COLOR_URGENCIA: Record<Urgencia, string> = {
  critico:  "text-destructive",
  atencion: "text-yellow-400",
  normal:   "text-muted-foreground",
};

const ICONO_URGENCIA: Record<Urgencia, typeof AlertTriangle> = {
  critico:  AlertTriangle,
  atencion: AlertCircle,
  normal:   Circle,
};

interface Props {
  orgId: string | undefined;
  /** Ventas del mes en curso. */
  ventasMes: number;
  /** Ventas del mes anterior, para comparar. */
  ventasMesAnterior: number;
  gananciaNetaMes: number;
  margenPct: number;
  sinStock: number;
  stockBajo: number;
  deudasPendientes: number;
  deudaTotalARS: number;
  deudasVencidas30: number;
  seguimientosHoy: number;
  onboardingGoal?: "pos" | "online" | "explore" | null;
  tiendaPublicada?: boolean;
  ordenesOnlinePagas?: number;
}

export default function FocoDelDia(p: Props) {
  const [porDespachar, setPorDespachar] = useState(0);
  const [porRetirar, setPorRetirar] = useState(0);
  const [pendientesDePago, setPendientesDePago] = useState(0);
  const [ventas, setVentas] = useState<{
    dias: number | null;
    huecos: number[];
    nuncaVendio: boolean;
  }>({ dias: null, huecos: [], nuncaVendio: false });
  const [sinConteo, setSinConteo] = useState(false);
  const [ofertasPendientes, setOfertasPendientes] = useState(0);
  const [carritosAbandonados, setCarritosAbandonados] = useState(0);
  const [productosSinPeso, setProductosSinPeso] = useState(0);
  const [zonasSinTarifa, setZonasSinTarifa] = useState(0);
  const [zonasActivas, setZonasActivas] = useState(0);

  useEffect(() => {
    if (!p.orgId) return;
    let cancelado = false;
    // `head: true` con `count`: trae el número, no las filas.
    supabase
      .from("ecommerce_orders")
      .select("payment_status, fulfillment_status, carrier, shipping_service")
      .eq("org_id", p.orgId)
      .eq("payment_status", "paid")
      .in("fulfillment_status", ["pending", "unfulfilled", "processing"])
      .limit(200)
      .then(({ data, error }) => {
        if (!cancelado && !error) {
          const n = countFulfillmentPulse(data ?? []);
          setPorDespachar(n.despachar);
          setPorRetirar(n.retirar);
        }
      });
    // No es el count de `vista=pago`: esa cola muestra el histórico.
    // Pulse sólo cuenta cobros que el comercio puede resolver ahora
    // (transferencia/efectivo, o Pay de las últimas 72 h).
    supabase
      .from("ecommerce_orders")
      .select("id, payment_status, payment_method, created_at")
      .eq("org_id", p.orgId)
      .in("payment_status", ["pending", "failed"])
      .limit(200)
      .then(({ data, error }) => {
        if (error) {
          console.error("FocoDelDia / pendientes de pago:", error);
          return;
        }
        if (!cancelado) setPendientesDePago(countActionableUnpaidOrders(data ?? []));
      });
    return () => { cancelado = true; };
  }, [p.orgId]);

  // El ritmo de ventas del comercio: cuántos días hace que no registra una, y
  // cuáles fueron sus huecos históricos. El umbral sale de su propia historia,
  // no de un número fijo — un fijo molesta al que vende todos los días y calla
  // al que vende una vez por mes.
  useEffect(() => {
    if (!p.orgId) return;
    let cancelado = false;
    const desde = new Date();
    desde.setDate(desde.getDate() - 365);
    supabase
      .from("sales")
      .select("date")
      .eq("org_id", p.orgId)
      .gte("date", desde.toISOString())
      .order("date", { ascending: true })
      .then(({ data, error }) => {
        // Igual que el contador de despachos: si falla, el bloque muestra el
        // resto. Pero se loguea — un panel que calla un error no se diagnostica.
        if (error) { console.error("FocoDelDia / ritmo de ventas:", error); return; }
        if (cancelado || !data) return;
        const dias = [...new Set(
          data.map(f => String(f.date).slice(0, 10)),
        )].sort();
        if (dias.length === 0) {
          setVentas({ dias: null, huecos: [], nuncaVendio: true });
          return;
        }
        const aDia = (s: string) => Math.floor(Date.parse(s + "T00:00:00Z") / 86400000);
        const huecos: number[] = [];
        for (let i = 1; i < dias.length; i++) huecos.push(aDia(dias[i]) - aDia(dias[i - 1]));
        const hoy = Math.floor(Date.now() / 86400000);
        setVentas({ dias: hoy - aDia(dias[dias.length - 1]), huecos, nuncaVendio: false });
      });
    return () => { cancelado = true; };
  }, [p.orgId]);

  useEffect(() => {
    if (!p.orgId) return;
    let cancelado = false;
    supabase
      .from("stock_counts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", p.orgId)
      .eq("status", "cerrado")
      .then(({ count, error }) => {
        if (error) {
          console.error("FocoDelDia / toma física:", error);
          return;
        }
        if (!cancelado) setSinConteo((count ?? 0) === 0);
      });
    return () => { cancelado = true; };
  }, [p.orgId]);

  useEffect(() => {
    if (!p.orgId) return;
    let cancelado = false;
    supabase
      .from("ai_offer_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", p.orgId)
      .eq("status", "pending")
      .then(({ count, error }) => {
        if (error) {
          console.error("FocoDelDia / ofertas IA:", error);
          return;
        }
        if (!cancelado) setOfertasPendientes(count ?? 0);
      });
    return () => { cancelado = true; };
  }, [p.orgId]);

  useEffect(() => {
    if (!p.orgId) return;
    let cancelado = false;
    supabase
      .from("ecommerce_cart_sessions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", p.orgId)
      .eq("status", "abandoned")
      .then(({ count, error }) => {
        if (error) {
          console.error("FocoDelDia / carritos abandonados:", error);
          return;
        }
        if (!cancelado) setCarritosAbandonados(count ?? 0);
      });
    return () => { cancelado = true; };
  }, [p.orgId]);

  // Señales ATM de conversión (pesos / tarifario) — mismas reglas que Tienda.
  useEffect(() => {
    if (!p.orgId) return;
    let cancelado = false;
    void Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true })
        .eq("org_id", p.orgId).gt("stock", 0).gt("sale_price_ars", 0).is("weight_kg", null),
      supabase.from("shipping_zones").select("id").eq("org_id", p.orgId).eq("is_active", true),
      supabase.from("shipping_rates").select("zone_id").eq("org_id", p.orgId).eq("is_active", true),
    ]).then(([sinPeso, zonas, tarifas]) => {
      if (cancelado) return;
      if (sinPeso.error) console.error("FocoDelDia / productos sin peso:", sinPeso.error);
      else setProductosSinPeso(sinPeso.count ?? 0);
      if (zonas.error || tarifas.error) {
        if (zonas.error) console.error("FocoDelDia / zonas:", zonas.error);
        if (tarifas.error) console.error("FocoDelDia / tarifas:", tarifas.error);
        return;
      }
      const filas = zonas.data ?? [];
      const conTarifa = new Set((tarifas.data ?? []).map(r => r.zone_id));
      setZonasActivas(filas.length);
      setZonasSinTarifa(filas.filter(z => !conTarifa.has(z.id)).length);
    });
    return () => { cancelado = true; };
  }, [p.orgId]);

  const datos: DatosFoco = {
    sinStock: p.sinStock,
    stockBajo: p.stockBajo,
    deudasPendientes: p.deudasPendientes,
    deudaTotalARS: p.deudaTotalARS,
    deudasVencidas30: p.deudasVencidas30,
    seguimientosHoy: p.seguimientosHoy,
    pedidosPorDespachar: porDespachar,
    pedidosPorRetirar: porRetirar,
    pedidosPendientesDePago: pendientesDePago,
    diasSinRegistrarVenta: ventas.dias,
    huecosEntreVentas: ventas.huecos,
    nuncaVendio: ventas.nuncaVendio,
    sinConteoFisico: sinConteo,
    ofertasIaPendientes: ofertasPendientes,
    carritosAbandonados,
    productosSinPeso,
    zonasSinTarifa,
    zonasActivas,
    onboardingGoal: p.onboardingGoal,
    tiendaPublicada: p.tiendaPublicada,
    ordenesOnlinePagas: p.ordenesOnlinePagas,
  };

  const pendientes = construirPendientes(datos);
  const nivel = nivelDelDia(pendientes);
  const variacion = leerVariacion(p.ventasMes, p.ventasMesAnterior);

  const FlechaVariacion = variacion.sentido === "sube" ? ArrowUp
    : variacion.sentido === "baja" ? ArrowDown : Minus;
  const colorVariacion = variacion.sentido === "sube" ? "text-emerald-400"
    : variacion.sentido === "baja" ? "text-destructive" : "text-muted-foreground";

  return (
    <section className="mb-6 grid gap-4 lg:grid-cols-3">
      {/* ── Cómo viene el mes ────────────────────────────────────────────── */}
      <div className="design-surface relative overflow-hidden p-5 lg:col-span-1">
        <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
          Ventas del mes
        </p>
        <p className="mt-2 text-3xl font-bold tracking-[-0.03em] tabular-nums">{formatARS(p.ventasMes)}</p>

        <p className={`text-sm mt-1.5 flex items-center gap-1 ${colorVariacion}`}>
          <FlechaVariacion className="w-4 h-4" />
          {/* Sin mes anterior no se inventa un porcentaje: "+100%" el primer mes
              es mentira, no un logro. */}
          {variacion.pct === null
            ? <span className="text-muted-foreground">Sin mes anterior para comparar</span>
            : variacion.pct === 0
              ? <span>Igual que el mes pasado</span>
              : <span>{Math.abs(variacion.pct)}% vs. el mes pasado</span>}
        </p>

        <div className="mt-4 pt-3 border-t border-border/60 flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Ganancia neta</span>
          <span className="text-sm font-semibold tabular-nums">
            {formatARS(p.gananciaNetaMes)}
            <span className="text-xs text-muted-foreground font-normal ml-1.5">
              {Math.round(p.margenPct)}% margen
            </span>
          </span>
        </div>
      </div>

      {/* ── Para hacer ahora ─────────────────────────────────────────────── */}
      <div className="design-surface p-5 lg:col-span-2">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
            Para hacer ahora
          </p>
          {pendientes.length > 0 && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full bg-muted/40 font-semibold ${COLOR_URGENCIA[nivel]}`}>
              {pendientes.length}
            </span>
          )}
        </div>

        {pendientes.length === 0 ? (
          // "Nada pendiente" es una respuesta útil, no un estado vacío que haya
          // que disimular con un dibujo.
          <p className="text-sm text-muted-foreground flex items-center gap-2 py-2">
            <Check className="w-4 h-4 text-emerald-400" />
            Nada pendiente. El stock está cubierto y no hay deudas vencidas.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {pendientes.map(x => {
              const Icono = ICONO_URGENCIA[x.urgencia];
              return (
                <li key={x.id}>
                  <Link
                    to={x.destino}
                    className="flex items-center justify-between gap-3 py-2.5 group"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icono className={`w-4 h-4 shrink-0 ${COLOR_URGENCIA[x.urgencia]}`} />
                      <span className="text-sm truncate">{x.texto}</span>
                    </span>
                    <span className="text-xs text-primary shrink-0 flex items-center gap-1 group-hover:underline">
                      {x.accion}
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
