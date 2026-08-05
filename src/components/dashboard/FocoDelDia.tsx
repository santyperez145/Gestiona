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
 * `src/lib/dashboardFocus.ts`, que es puro y tiene 12 tests.
 *
 * No recalcula nada: todo sale del `stats` que el panel ya computa. La única
 * consulta propia es el conteo de pedidos pagados sin despachar, que el panel
 * no traía y es el pendiente donde el que espera es un cliente que ya pagó.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  construirPendientes, leerVariacion, nivelDelDia,
  type DatosFoco, type Urgencia,
} from "@/lib/dashboardFocus";
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
}

export default function FocoDelDia(p: Props) {
  const [porDespachar, setPorDespachar] = useState(0);

  useEffect(() => {
    if (!p.orgId) return;
    let cancelado = false;
    // `head: true` con `count`: trae el número, no las filas.
    supabase
      .from("ecommerce_orders")
      .select("id", { count: "exact", head: true })
      .eq("org_id", p.orgId)
      .eq("payment_status", "paid")
      .in("fulfillment_status", ["pending", "unfulfilled", "processing"])
      .then(({ count, error }) => {
        // Si falla, el bloque muestra el resto igual: un panel que no carga por
        // un contador es peor que un contador que falta.
        if (!cancelado && !error) setPorDespachar(count ?? 0);
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
      <div className="bg-card border border-border rounded-xl p-5 shadow-card lg:col-span-1">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
          Ventas del mes
        </p>
        <p className="text-3xl font-bold mt-1 tabular-nums">{formatARS(p.ventasMes)}</p>

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
      <div className="bg-card border border-border rounded-xl p-5 shadow-card lg:col-span-2">
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
