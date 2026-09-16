/**
 * Recovery Ledger — historial comparativo de carritos abandonados vs recuperados.
 * Diferencial real de Nerqia: no un panel más, sino un registro contable que muestra
 * el GMV en riesgo, el recuperado y la tasa de conversión por período.
 */

import { useEffect, useState } from "react";
import { Calendar, Download, Filter, TrendingUp, Package, Mail, AlertTriangle } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { getRecoveryHistory, type RecoveryLedgerEntry } from "@/lib/abandonedCarts";
import { formatARS } from "@/lib/supabaseStore";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";

type LedgerPeriod = "today" | "7d" | "30d" | "90d" | "custom";

interface Props {
  orgId: string | null;
  storeId: string | null;
  storeSlug: string | null;
}

export default function RecoveryLedger({ orgId, storeId, storeSlug }: Props) {
  const { activeOrg } = useOrg();
  const [period, setPeriod] = useState<LedgerPeriod>("7d");
  const [customDesde, setCustomDesde] = useState<string>(
    format(subDays(new Date(), 7), "yyyy-MM-dd")
  );
  const [customHasta, setCustomHasta] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [entries, setEntries] = useState<RecoveryLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolveRange = () => {
    const now = new Date();
    switch (period) {
      case "today":
        return { desde: format(startOfDay(now), "yyyy-MM-dd"), hasta: format(endOfDay(now), "yyyy-MM-dd") };
      case "7d":
        return { desde: format(subDays(startOfDay(now), 7), "yyyy-MM-dd"), hasta: format(endOfDay(now), "yyyy-MM-dd") };
      case "30d":
        return { desde: format(subDays(startOfDay(now), 30), "yyyy-MM-dd"), hasta: format(endOfDay(now), "yyyy-MM-dd") };
      case "90d":
        return { desde: format(subDays(startOfDay(now), 90), "yyyy-MM-dd"), hasta: format(endOfDay(now), "yyyy-MM-dd") };
      default:
        return { desde: customDesde, hasta: customHasta };
    }
  };

  const load = async () => {
    const org = orgId || activeOrg?.id;
    const store = storeId;
    if (!org || !store) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { desde, hasta } = resolveRange();
    try {
      const data = await getRecoveryHistory(org, store, desde, hasta);
      setEntries(data);
    } catch (err: any) {
      setError(err?.message || "Error cargando ledger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [period, customDesde, customHasta, orgId, storeId, activeOrg?.id]);

  const totals = entries.reduce(
    (acc, e) => {
      acc.totalGMV += e.total;
      if (e.status === "converted") acc.recoveredGMV += e.total;
      if (e.abandoned_email_sent) acc.sentCount += 1;
      acc.count += 1;
      return acc;
    },
    { count: 0, totalGMV: 0, recoveredGMV: 0, sentCount: 0 }
  );

  const recoveryRate = totals.totalGMV > 0 ? (totals.recoveredGMV / totals.totalGMV) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-center gap-3 bg-card border border-border/40 rounded-xl p-4">
        <div className="flex gap-2 flex-wrap">
          {(["today", "7d", "30d", "90d"] as LedgerPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => { setPeriod(p); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p === "today" ? "Hoy" : p === "7d" ? "7 días" : p === "30d" ? "30 días" : "90 días"}
            </button>
          ))}
          <button
            onClick={() => setPeriod("custom")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              period === "custom"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            <Filter className="w-3.5 h-3.5 inline mr-1" /> Personalizado
          </button>
        </div>

        {period === "custom" && (
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <label className="text-xs text-muted-foreground">Desde</label>
            <input
              type="date"
              value={customDesde}
              onChange={(e) => setCustomDesde(e.target.value)}
              className="bg-muted border-border h-9 px-3 text-sm rounded-lg"
            />
            <label className="text-xs text-muted-foreground">Hasta</label>
            <input
              type="date"
              value={customHasta}
              onChange={(e) => setCustomHasta(e.target.value)}
              className="bg-muted border-border h-9 px-3 text-sm rounded-lg"
            />
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 text-xs hover:bg-muted/50 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" /> Aplicar
            </button>
          </div>
        )}
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-yellow-500/15 text-yellow-500">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Carritos en período</p>
              <p className="text-xl font-bold">{totals.count}</p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-500/15 text-blue-500">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">GMV en riesgo</p>
              <p className="text-xl font-bold">{formatARS(totals.totalGMV)}</p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-500">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">GMV recuperado</p>
              <p className="text-xl font-bold text-emerald-400">{formatARS(totals.recoveredGMV)}</p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/15 text-primary">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tasa de recuperación</p>
              <p className="text-xl font-bold">{recoveryRate.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabla Ledger ── */}
      <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
        {error && (
          <div className="p-4 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Carrito</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Cliente</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Items</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Total</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Estado</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Aviso</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Creado</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Actualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    Cargando ledger…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    Sin carritos en este período
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {e.id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {e.customer_email || (
                        <span className="text-muted-foreground italic">— sin email —</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-mono">{e.items_count}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {formatARS(e.total)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                        e.status === "converted"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                          : e.status === "abandoned"
                          ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/20"
                          : "bg-muted text-muted-foreground border-border/30"
                      }`}>
                        {e.status === "converted" ? (
                          <>
                            <TrendingUp className="w-3 h-3" />
                            Recuperado
                          </>
                        ) : e.status === "abandoned" ? (
                          <>
                            <AlertTriangle className="w-3 h-3" />
                            Abandonado
                          </>
                        ) : (
                          "Activo"
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {e.abandoned_email_sent ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                          <Mail className="w-3 h-3" /> Enviado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border/30">
                          <Mail className="w-3 h-3" /> Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                      {format(new Date(e.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                      {e.converted_at
                        ? format(new Date(e.converted_at), "dd/MM/yyyy HH:mm", { locale: es })
                        : format(new Date(e.updated_at), "dd/MM/yyyy HH:mm", { locale: es })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Export ── */}
        <div className="px-4 py-3 border-t border-border/40 bg-muted/20 flex items-center justify-end gap-2">
          <button
            onClick={() => {
              const csv = [
                ["Carrito", "Cliente", "Items", "Total", "Estado", "Aviso", "Creado", "Actualizado"],
                ...entries.map((e) => [
                  e.id,
                  e.customer_email || "",
                  String(e.items_count),
                  String(e.total),
                  e.status,
                  e.abandoned_email_sent ? "Enviado" : "Pendiente",
                  e.created_at,
                  e.converted_at || e.updated_at,
                ]),
              ]
                .map((r) => r.map((c) => `"${c}"`).join(","))
                .join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `recovery-ledger-${format(new Date(), "yyyy-MM-dd")}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            disabled={entries.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 text-xs hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </button>
        </div>
      </div>
    </div>
  );
}