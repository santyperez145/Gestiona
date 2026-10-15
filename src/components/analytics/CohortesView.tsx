// Vista «Cohortes» del workspace de Analytics.
//
// 2026-10-15: se rehízo sobre las ventas reales. Antes leía `bi_snapshots` y
// `saved_reports` (vacías en toda la plataforma; la función que llenaba los
// snapshots ya no existe), así que «Ingresos de hoy» daba siempre $0K. Y tenía
// botones que sólo mostraban un aviso: «Actualizar snapshot», descargar CSV,
// compartir, «Ejecutar» un informe (contaba +1 y decía «descarga lista» sin
// descargar nada) y el drill-down. El desglose por producto, cliente,
// categoría y vendedor ya vive en Resumen; acá queda lo propio de esta vista:
// el pulso de los últimos días y cuántos clientes de cada mes vuelven.
import { useEffect, useMemo, useState } from "react";
import { BarChart3, DollarSign, Users, Repeat, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSalesDB, formatARS } from "@/lib/supabaseStore";
import { cohortesDeClientes, diasAtras, type Venta } from "@/lib/cohortes";
import { claveDeCompra, diaDeCompra } from "@/lib/comprasDeCliente";
import { fmtPct } from "@/lib/porcentaje";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

function Celda({ valor }: { valor: number | null }) {
  if (valor === null) return <td className="px-2 py-2 text-center text-xs text-muted-foreground/30">—</td>;
  const intensidad = valor / 100;
  return (
    <td className="px-2 py-2 text-center">
      <div className="rounded px-2 py-1 text-xs font-semibold" style={{
        background: `hsla(160, 60%, 45%, ${intensidad * 0.7 + 0.05})`,
        color: intensidad > 0.3 ? "white" : "#6b7280",
      }}>
        {valor}%
      </div>
    </td>
  );
}

export default function CohortesView() {
  const { user } = useAuth();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let vigente = true;
    setCargando(true);
    setError(null);
    getSalesDB(user.id)
      .then(s => { if (vigente) setVentas((s ?? []) as Venta[]); })
      .catch(e => { if (vigente) setError(mensajeDeError(e)); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [user]);

  const dias = useMemo(() => diasAtras(14), []);
  const porDia = useMemo(() => {
    const mapa = new Map(dias.map(d => [d, { ingresos: 0, compras: new Set<string>() }]));
    for (const v of ventas) {
      const d = mapa.get(diaDeCompra(v.date));
      if (!d) continue;
      d.ingresos += Number(v.total_ars) || 0;
      d.compras.add(claveDeCompra(v));
    }
    return dias.map(d => ({ dia: d, ingresos: mapa.get(d)!.ingresos, compras: mapa.get(d)!.compras.size }));
  }, [ventas, dias]);

  const hoy = porDia[porDia.length - 1];
  const ultimos7 = porDia.slice(-7);
  const ingresos7 = ultimos7.reduce((s, d) => s + d.ingresos, 0);
  const compras7 = ultimos7.reduce((s, d) => s + d.compras, 0);
  const cohortes = useMemo(() => cohortesDeClientes(ventas), [ventas]);
  const recompra = useMemo(() => {
    const conDatos = cohortes.filter(c => c.retencion[1] !== null && c.clientes > 0);
    const total = conDatos.reduce((s, c) => s + c.clientes, 0);
    if (total === 0) return null;
    return conDatos.reduce((s, c) => s + (c.retencion[1] ?? 0) * c.clientes, 0) / total;
  }, [cohortes]);
  const maximo = Math.max(1, ...porDia.map(d => d.ingresos));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        title="Cohortes"
        description="El pulso de los últimos días y cuántos clientes de cada mes vuelven a comprar."
      />

      {error && (
        <p className="rounded-[8px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          No pudimos leer las ventas: {error}
        </p>
      )}

      {cargando ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando ventas
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard label="Ingresos de hoy" value={formatARS(hoy?.ingresos ?? 0)} icon={DollarSign} color="success"
              sub={`${hoy?.compras ?? 0} ${hoy?.compras === 1 ? "compra" : "compras"}`} />
            <KPICard label="Últimos 7 días" value={formatARS(ingresos7)} icon={BarChart3} color="primary"
              sub={`${compras7} ${compras7 === 1 ? "compra" : "compras"}`} />
            <KPICard label="Ticket promedio (7 días)" value={formatARS(compras7 > 0 ? ingresos7 / compras7 : 0)} icon={Users} color="blue"
              sub="por compra, no por renglón" />
            <KPICard label="Vuelven al mes siguiente" value={recompra === null ? "—" : fmtPct(recompra)} icon={Repeat} color="warning"
              sub={recompra === null ? "todavía no hay un mes completo para medir" : "promedio de las cohortes"} />
          </div>

          <section className="rounded-xl border border-border/40 bg-card p-5">
            <h3 className="mb-4 text-sm font-semibold">Ingresos por día — últimas dos semanas</h3>
            <div className="flex h-28 items-end gap-1">
              {porDia.map(d => (
                <div key={d.dia} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t-sm bg-primary/60" style={{ height: `${(d.ingresos / maximo) * 88}px` }}
                    title={`${d.dia.split("-").reverse().join("/")}: ${formatARS(d.ingresos)} · ${d.compras} compras`} />
                  <span className="text-[9px] text-muted-foreground">{d.dia.slice(8)}</span>
                </div>
              ))}
            </div>
            {ingresos7 === 0 && porDia.every(d => d.ingresos === 0) && (
              <p className="mt-3 text-xs text-muted-foreground">No hubo ventas en las últimas dos semanas.</p>
            )}
          </section>

          <section className="rounded-xl border border-border/40 bg-card p-5">
            <h3 className="mb-1 text-sm font-semibold">Retención por mes de primera compra</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              De los clientes que compraron por primera vez en cada mes, qué parte volvió a comprar en los meses siguientes. Mostrador y tienda online juntos; las ventas sin cliente no cuentan.
            </p>
            {cohortes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay ventas con cliente para armar cohortes.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="px-2 py-2 text-left font-medium">Mes</th>
                      <th className="px-2 py-2 text-right font-medium">Clientes</th>
                      {["Mes 0", "Mes 1", "Mes 2", "Mes 3", "Mes 4", "Mes 5"].map(h => (
                        <th key={h} className="px-2 py-2 text-center font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cohortes.map(c => (
                      <tr key={c.mes} className="border-t border-border/30">
                        <td className="px-2 py-2 text-xs font-medium">{c.mes}</td>
                        <td className="px-2 py-2 text-right text-xs tabular-nums">{c.clientes}</td>
                        {c.retencion.map((v, i) => <Celda key={i} valor={v} />)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
