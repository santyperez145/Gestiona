/**
 * Monotributo en la página de ARCA (2026-10-21): facturación de los últimos 12
 * meses, categoría que corresponde por ingresos y productos con precio por
 * encima del máximo unitario. Ver `lib/monotributo.ts`.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Gauge, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { hoyAR } from "@/lib/fechaAR";
import {
  ESCALA_MONOTRIBUTO, categoriaPorIngresos, facturadoEntre, proximaRecategorizacion, situacionMonotributo, ventanaDeDoceMeses,
  type ComprobanteMonotributo, type SituacionMonotributo,
} from "@/lib/monotributo";

const PAGINA = 1000;
const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fecha = (iso: string) => iso.split("-").reverse().join("/");

type Lectura =
  | { estado: "cargando" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; situacion: SituacionMonotributo; caros: { name: string; sale_price_ars: number }[]; carosTotal: number;
      recategorizacion: ReturnType<typeof proximaRecategorizacion> & { facturado: number } };

export default function MonotributoPanel({ orgId }: { orgId: string | null }) {
  const [lectura, setLectura] = useState<Lectura>({ estado: "cargando" });

  const leer = useCallback(async (signal: { cancelado: boolean }) => {
    if (!orgId) return;
    setLectura({ estado: "cargando" });
    const hoy = hoyAR();
    const ventana = ventanaDeDoceMeses(hoy);
    const recategorizacion = proximaRecategorizacion(hoy);
    // Se lee desde lo que mire primero: los 12 meses o el período de la recategorización.
    const desde = recategorizacion.desde < ventana.desde ? recategorizacion.desde : ventana.desde;
    const hasta = ventana.hasta;
    const filas: (ComprobanteMonotributo & { afip_environment: string | null })[] = [];
    for (let desdeFila = 0; ; desdeFila += PAGINA) {
      const { data, error } = await supabase
        .from("invoices")
        .select("issue_date, tipo_comprobante, total, afip_environment")
        .eq("org_id", orgId)
        .eq("afip_status", "authorized")
        .not("cae", "is", null)
        .gte("issue_date", desde)
        .lte("issue_date", hasta)
        .order("issue_date")
        .order("id")
        .range(desdeFila, desdeFila + PAGINA - 1);
      if (signal.cancelado) return;
      if (error) {
        console.error("Monotributo: no se pudieron leer las facturas", error);
        setLectura({ estado: "error", mensaje: "No se pudo leer tu facturación. Reintentá en unos minutos." });
        return;
      }
      filas.push(...((data ?? []) as typeof filas));
      if ((data ?? []).length < PAGINA) break;
    }
    const { data: caros, count, error: errorProductos } = await supabase
      .from("products")
      .select("name, sale_price_ars", { count: "exact" })
      .eq("org_id", orgId)
      .eq("is_active", true)
      .gt("sale_price_ars", ESCALA_MONOTRIBUTO.precioUnitarioMaximo)
      .order("sale_price_ars", { ascending: false })
      .limit(5);
    if (signal.cancelado) return;
    if (errorProductos) {
      console.error("Monotributo: no se pudieron leer los productos", errorProductos);
      setLectura({ estado: "error", mensaje: "No se pudieron revisar los precios de tus productos. Reintentá en unos minutos." });
      return;
    }
    const validas = filas.filter(f => f.afip_environment !== "homologacion");
    setLectura({
      estado: "listo",
      situacion: situacionMonotributo(validas, hoy),
      recategorizacion: { ...recategorizacion, facturado: facturadoEntre(validas, recategorizacion.desde, recategorizacion.hasta) },
      caros: (caros ?? []) as { name: string; sale_price_ars: number }[],
      carosTotal: count ?? (caros ?? []).length,
    });
  }, [orgId]);

  useEffect(() => {
    const signal = { cancelado: false };
    void leer(signal);
    return () => { signal.cancelado = true; };
  }, [leer]);

  return (
    <section className="bg-card border border-border/40 rounded-xl p-5 space-y-4" aria-labelledby="monotributo-titulo">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Gauge className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 id="monotributo-titulo" className="font-semibold">Tu monotributo</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Lo que facturaste con CAE en los últimos 12 meses contra la escala de ARCA vigente desde el {fecha(ESCALA_MONOTRIBUTO.vigenteDesde)}.
            </p>
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={() => void leer({ cancelado: false })} disabled={lectura.estado === "cargando"} aria-label="Volver a calcular">
          <RefreshCw className={`w-4 h-4 ${lectura.estado === "cargando" ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {lectura.estado === "cargando" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Sumando tu facturación…</p>
      )}

      {lectura.estado === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {lectura.mensaje}
          <Button size="sm" variant="outline" onClick={() => void leer({ cancelado: false })}>Reintentar</Button>
        </div>
      )}

      {lectura.estado === "listo" && (() => {
        const s = lectura.situacion;
        const uso = Math.min(100, Math.round(s.usoDelMaximo * 100));
        return (
          <>
            {s.escalaDesactualizada && (
              <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                ARCA ya debería haber publicado una escala nueva. Estos topes pueden estar desactualizados: confirmalos en{" "}
                <a className="underline" href={ESCALA_MONOTRIBUTO.fuente} target="_blank" rel="noreferrer">la página de categorías de ARCA</a>.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground">Facturado {fecha(s.desde)} – {fecha(s.hasta)}</p>
                <p className="text-lg font-semibold">{ars(s.facturado)}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground">Categoría por ingresos</p>
                <p className="text-lg font-semibold">{s.categoria ?? "Superaste la K"}</p>
                {s.tope !== null && <p className="text-[11px] text-muted-foreground">Tope {ars(s.tope)}</p>}
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground">Margen hasta el tope</p>
                <p className="text-lg font-semibold">{s.margen !== null ? ars(s.margen) : "—"}</p>
              </div>
            </div>

            {(() => {
              const cat = s.categoria ? ESCALA_MONOTRIBUTO.categorias.find(c => c.categoria === s.categoria) : null;
              const r = lectura.recategorizacion;
              const catRecat = categoriaPorIngresos(r.facturado);
              return (
                <div className="grid gap-3 sm:grid-cols-2 text-xs">
                  {cat && (
                    <div className="rounded-lg border border-border/40 p-3">
                      <p className="text-muted-foreground">Cuota mensual de la categoría {cat.categoria} (vence el 20)</p>
                      <p className="mt-1"><span className="font-semibold">{ars(cat.cuotaVenta)}</span> venta de productos · {ars(cat.cuotaServicios)} servicios</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Incluye impuesto integrado, jubilación y obra social.</p>
                    </div>
                  )}
                  <div className="rounded-lg border border-border/40 p-3">
                    <p className="text-muted-foreground">Próxima recategorización: hasta el {fecha(r.vence)}</p>
                    <p className="mt-1">
                      ARCA mira lo facturado del {fecha(r.desde)} al {fecha(r.hasta)}:{" "}
                      <span className="font-semibold">{ars(r.facturado)}</span>{r.completo ? "" : " hasta hoy"}
                      {catRecat ? ` → categoría ${catRecat.categoria}` : " → supera la K"}.
                    </p>
                    {!r.completo && <p className="mt-1 text-[11px] text-muted-foreground">El período todavía no cerró: la cifra puede subir.</p>}
                  </div>
                </div>
              );
            })()}

            <div>
              <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                <span>Uso del tope máximo del régimen (categoría K)</span><span>{uso} %</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={uso} aria-valuemin={0} aria-valuemax={100} aria-label="Uso del tope de la categoría K">
                <div className={`h-full ${uso >= 90 ? "bg-destructive" : uso >= 75 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${uso}%` }} />
              </div>
            </div>

            {s.excedido ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                Lo facturado supera el tope de la categoría K. Superarlo es causal de exclusión del monotributo: consultalo con tu contador cuanto antes.
              </p>
            ) : uso >= 90 && (
              <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                Estás cerca del tope máximo del monotributo. Si lo superás, quedás excluido del régimen: conviene planificarlo con tu contador.
              </p>
            )}

            {lectura.carosTotal > 0 && (
              <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  {lectura.carosTotal === 1 ? "1 producto activo supera" : `${lectura.carosTotal} productos activos superan`} el precio unitario máximo del monotributo ({ars(ESCALA_MONOTRIBUTO.precioUnitarioMaximo)}).
                </p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {lectura.caros.map(p => <li key={p.name}>{p.name}: {ars(Number(p.sale_price_ars))}</li>)}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Sólo se miran los ingresos facturados con CAE. La categoría también depende de la superficie, la energía y los alquileres;
              la recategorización la hacés vos (o tu contador) en ARCA.
            </p>
          </>
        );
      })()}
    </section>
  );
}
