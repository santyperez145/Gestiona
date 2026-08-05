/**
 * Negocio de la plataforma, comercio por comercio.
 *
 * "Comisiones" responde cuánto entró este mes; esta pantalla responde de
 * quién, y —lo que ninguna otra contestaba— quién dejó de facturar. El MRR de
 * suscripciones no lo dice: un comercio puede estar al día con el plan y no
 * haber vendido nada en dos meses, y ese es exactamente el que se da de baja.
 *
 * El orden por defecto no es alfabético ni por facturación: es por urgencia.
 * Lo primero que se ve es lo que hay que hacer hoy.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePlatformAccess } from "@/lib/usePermissions";
import { toast } from "sonner";
import {
  Building2, DollarSign, TrendingUp, TrendingDown, AlertTriangle,
  RefreshCw, Loader2, Percent, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  SENALES, ordenarPorAtencion, resumirPlataforma, pesos, desdeUltimoCobro,
  esUrgente, type OrgHealthRow, type Senal,
} from "@/lib/orgHealth";

const TONO_BADGE: Record<string, string> = {
  destructive: "bg-red-500/15 text-red-400 border-red-500/20",
  warning:     "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  blue:        "bg-blue-500/15 text-blue-400 border-blue-500/20",
  success:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  primary:     "bg-muted text-muted-foreground border-border",
};

export default function PlatformBusinessPage() {
  usePageTitle("Negocio");
  const { canBilling, loading: accessLoading } = usePlatformAccess();

  const [rows, setRows] = useState<OrgHealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [senalFiltro, setSenalFiltro] = useState<Senal | "todas">("todas");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_org_health")
      .select("*");
    setLoading(false);
    // Sin `?? []`: la vista filtra por is_platform_admin() adentro, así que
    // vacío por permisos y "no hay comercios" se ven igual y no son lo mismo.
    if (error) { toast.error("No se pudo cargar el negocio: " + error.message); return; }
    setRows((data ?? []) as unknown as OrgHealthRow[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resumen = useMemo(() => resumirPlataforma(rows), [rows]);

  const visibles = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return ordenarPorAtencion(
      rows.filter(r =>
        (senalFiltro === "todas" || r.senal === senalFiltro) &&
        (!texto || r.org_name?.toLowerCase().includes(texto) || r.slug?.toLowerCase().includes(texto)),
      ),
    );
  }, [rows, q, senalFiltro]);

  if (accessLoading) {
    return <div className="py-20 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!canBilling) return <Navigate to="/platform" replace />;

  const urgentes = rows.filter(r => esUrgente(r.senal));

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        icon={Building2}
        title="Negocio"
        description="Cuánto factura cada comercio, y quién dejó de hacerlo"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="GMV 30 días" value={pesos(resumen.gmv30)} icon={DollarSign} color="primary"
          sub={resumen.variacionPct === null
            ? "sin mes anterior para comparar"
            : `${resumen.variacionPct >= 0 ? "+" : ""}${resumen.variacionPct}% vs 30d previos`}
        />
        <KPICard
          label="Comisión 30 días" value={pesos(resumen.comision30)} icon={Percent} color="success"
          sub={`${pesos(resumen.comisionTotal)} desde siempre`}
        />
        <KPICard
          label="Comercios que venden" value={`${resumen.activos30}/${resumen.comercios}`}
          icon={resumen.activos30 > 0 ? TrendingUp : TrendingDown}
          color={resumen.activos30 > 0 ? "blue" : "warning"}
          sub={`${resumen.porSenal.sin_activar} nunca cobraron`}
        />
        <KPICard
          label="GMV en riesgo" value={pesos(resumen.gmvEnRiesgo)} icon={AlertTriangle}
          color={resumen.gmvEnRiesgo > 0 ? "destructive" : "success"}
          sub={`${urgentes.length} ${urgentes.length === 1 ? "comercio necesita" : "comercios necesitan"} atención`}
        />
      </div>

      {/* Filtros por señal. El número al lado es lo que hace que se usen. */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl flex-wrap">
        <button
          onClick={() => setSenalFiltro("todas")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            senalFiltro === "todas" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Todos ({rows.length})
        </button>
        {(Object.keys(SENALES) as Senal[])
          .sort((a, b) => SENALES[a].prioridad - SENALES[b].prioridad)
          .map(s => (
            <button
              key={s} onClick={() => setSenalFiltro(s)}
              title={SENALES[s].accion}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                senalFiltro === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {SENALES[s].label} ({resumen.porSenal[s]})
            </button>
          ))}
      </div>

      {senalFiltro !== "todas" && (
        <p className="text-xs text-muted-foreground -mt-2">{SENALES[senalFiltro].accion}</p>
      )}

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar comercio…" className="pl-9" />
      </div>

      {loading ? (
        <div className="py-16 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : visibles.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center">
          <Building2 className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
          <p className="font-medium">Ningún comercio con ese filtro</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[52rem]">
            <thead className="border-b border-border bg-muted/20">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Comercio</th>
                <th className="px-3 py-2 font-medium">Señal</th>
                <th className="px-3 py-2 font-medium text-right">GMV 30d</th>
                <th className="px-3 py-2 font-medium text-right">30d previos</th>
                <th className="px-3 py-2 font-medium text-right">Comisión 30d</th>
                <th className="px-3 py-2 font-medium text-right">Cobros</th>
                <th className="px-3 py-2 font-medium">Último cobro</th>
                <th className="px-3 py-2 font-medium">Plan</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(r => {
                const meta = SENALES[r.senal];
                return (
                  <tr key={r.org_id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <p className="font-medium truncate max-w-[14rem]">{r.org_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.productos} prod. · {r.miembros} {r.miembros === 1 ? "usuario" : "usuarios"}
                        {r.tiendas_activas > 0 && " · tienda online"}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={`text-[11px] ${TONO_BADGE[meta?.tono ?? "primary"]}`} title={meta?.accion}>
                        {meta?.label ?? r.senal}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {pesos(r.gmv_30d)}
                      {r.variacion_pct !== null && (
                        <span className={`ml-1.5 text-[11px] ${Number(r.variacion_pct) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {Number(r.variacion_pct) >= 0 ? "+" : ""}{r.variacion_pct}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{pesos(r.gmv_prev_30d)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-400">{pesos(r.comision_30d)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {r.cobros_30d}<span className="text-[11px]"> / {r.cobros_total}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{desdeUltimoCobro(r.dias_sin_cobrar)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.plan_name ?? "—"}
                      <span className="block text-[11px]">{r.subscription_status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        El GMV cuenta sólo cobros aprobados: un pago rechazado no es facturación. La
        comisión es la que quedó registrada en cada cobro, no un porcentaje recalculado
        — es el mismo número que informa la liquidación.
      </p>
    </div>
  );
}
